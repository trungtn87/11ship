import 'dart:async';

import 'package:flutter/material.dart';

import 'brand.dart';
import 'config.dart';
import 'health.dart';
import 'account/session_controller.dart';
import 'm08/m08_controller.dart';
import 'm08/m08_models.dart';
import 'm08/m08_push.dart';
import 'm08/m08_views.dart';
import 'm13/m13_update.dart';
import 'm13/m13_views.dart';
import 'tokens.dart';
import 'widgets/components.dart';
import 'widgets/connection_banner.dart';
import 'widgets/diagnostics_view.dart';

/// What the shell needs to keep the notifications alive (M08): the inbox state, how an opened notification reaches its object in THIS app, and the push link.
class NotificationShell {
  const NotificationShell({required this.controller, required this.router, this.push});

  final NotificationController controller;
  final NotificationRouter router;
  final PushSync? push;
}

/// What a tab body can ask the shell to do.
class ShellActions {
  const ShellActions({required this.goTab, required this.openDiagnostics});

  /// Switches to the tab with this id.
  final void Function(String id) goTab;

  /// Opens "Chẩn đoán kết nối" inside the current tab (the bottom navigation stays).
  final VoidCallback openDiagnostics;
}

typedef TabBody = Widget Function(BuildContext context, ShellActions actions);

/// One bottom-navigation tab: its label and icon, the title of its screen and its body.
class TabSpec {
  const TabSpec({required this.id, required this.label, required this.icon, required this.title, required this.body, this.showLogo = false, this.fullBleed = false, this.showAppBar = true, this.ownsConnectionBanner = false});

  final String id;
  final String label;
  final IconData icon;
  final String title;

  /// Home screens show the brand logo in the app bar instead of a centred title.
  final bool showLogo;
  /// Map-based screens own their layout and scrolling, without shell padding.
  final bool fullBleed;
  final bool showAppBar;

  /// The tab draws the connection state itself (merged with its own alerts) and reads the monitor from [HealthScope]: the shell then shows no second banner.
  final bool ownsConnectionBanner;
  final TabBody body;
}

/// The whole app: theme, shell and the real server connection check.
class N11App extends StatelessWidget {
  const N11App({
    super.key,
    required this.brand,
    required this.tabs,
    required this.config,
    this.transport,
    this.navigationIdentity,
    this.pollInterval = const Duration(seconds: 30),
    this.notifications,
    this.updates,
  });

  final String? navigationIdentity;
  final AppBrand brand;
  final List<TabSpec> tabs;
  final AppConfig config;

  /// The M13 update check of this app. Null = the shell shows no update banner (tests, a build without a server address).
  final AppUpdateController? updates;

  /// Live notifications, the push tap and the foreground resync (M08). Null = the shell does none of it (a build without notifications).
  final NotificationShell? notifications;

  /// Replaced only by tests; the real app uses [httpHealthTransport].
  final HealthTransport? transport;

  /// Re-check every this long while the app is in the foreground. Zero = only on demand (tests).
  final Duration pollInterval;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: brand.name,
      debugShowCheckedModeBanner: false,
      theme: buildN11Theme(),
      builder: updates == null ? null : (BuildContext context, Widget? child) => AppUpdateGate(controller: updates!, child: child ?? const SizedBox.shrink()),
      home: N11Shell(navigationIdentity: navigationIdentity, brand: brand, tabs: tabs, config: config, transport: transport, pollInterval: pollInterval, notifications: notifications),
    );
  }
}

class N11Shell extends StatefulWidget {
  const N11Shell({super.key, required this.brand, required this.tabs, required this.config, this.navigationIdentity, this.transport, this.pollInterval = const Duration(seconds: 30), this.notifications});

  final String? navigationIdentity;
  final AppBrand brand;
  final List<TabSpec> tabs;
  final AppConfig config;
  final HealthTransport? transport;
  final Duration pollInterval;
  final NotificationShell? notifications;

  @override
  State<N11Shell> createState() => _N11ShellState();
}

class _N11ShellState extends State<N11Shell> with WidgetsBindingObserver {
  late final HealthMonitor _monitor;
  int _index = 0;
  bool _diagnostics = false;
  bool _foreground = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _monitor = HealthMonitor(
      baseUrl: widget.config.apiUri,
      transport: widget.transport ?? httpHealthTransport,
      pollInterval: widget.pollInterval,
      shouldPoll: () => _foreground,
    );
    _monitor.start();
    _attachNotifications();
  }

  void _attachNotifications() {
    final NotificationShell? shell = widget.notifications;
    if (shell == null) {
      return;
    }
    shell.controller.addListener(_routePendingOpen);
    shell.controller.onLiveItems = _announce;
    // Cold start and a returning phone: read the server again, then keep listening while the app is open.
    unawaited(shell.controller.resync());
    WidgetsBinding.instance.addPostFrameCallback((_) => _routePendingOpen());
  }

  /// A short in-app notice for something that arrived while the app is open. A refreshed card or a retried event never repeats it (the controller filters).
  void _announce(List<NotificationItem> items) {
    if (!mounted || items.isEmpty) {
      return;
    }
    final String text = items.length == 1 ? items.first.title : '${items.length} thông báo mới';
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(key: const Key('live-notice'), content: Text(text), duration: const Duration(seconds: 3)));
  }

  /// A tap on a push waits in the controller until the person is signed in and the shell is on screen; the server then re-checks the right and the state.
  void _routePendingOpen() {
    final NotificationShell? shell = widget.notifications;
    if (shell == null || !mounted || !shell.controller.hasPendingOpen || shell.controller.session.status != SessionStatus.signedIn) {
      return;
    }
    final String? id = shell.controller.takePendingOpen();
    if (id == null) {
      return;
    }
    unawaited(openNotification(context, shell.controller, shell.router, ShellActions(goTab: _goTab, openDiagnostics: _openDiagnostics), id: id));
  }

  @override
  void didUpdateWidget(N11Shell oldWidget) {
    super.didUpdateWidget(oldWidget);
    final String selected = oldWidget.tabs[_index].id;
    final int next = widget.tabs.indexWhere((TabSpec tab) => tab.id == selected);
    _index = next < 0 || (widget.navigationIdentity != null && oldWidget.navigationIdentity != widget.navigationIdentity) ? 0 : next;
    if (widget.navigationIdentity != oldWidget.navigationIdentity) {
      // Another account signed in on this phone: its inbox is read from the server and its live sync starts; nothing of the previous one is kept.
      unawaited(widget.notifications?.controller.resync());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    final NotificationShell? shell = widget.notifications;
    if (shell != null) {
      shell.controller.removeListener(_routePendingOpen);
      shell.controller.onLiveItems = null;
      shell.controller.stopLive();
    }
    _monitor.stop();
    _monitor.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final bool visible = state == AppLifecycleState.resumed;
    final bool returned = visible && !_foreground;
    _foreground = visible;
    if (returned) {
      // Back in the foreground: do not trust an answer that is minutes old.
      unawaited(_monitor.check());
      unawaited(widget.notifications?.controller.resync());
      unawaited(widget.notifications?.push?.resync());
    } else if (!visible) {
      widget.notifications?.controller.stopLive();
    }
  }

  void _select(int index) {
    if (index == _index && !_diagnostics) {
      return;
    }
    setState(() {
      _index = index;
      _diagnostics = false;
    });
  }

  void _goTab(String id) {
    final int index = widget.tabs.indexWhere((TabSpec tab) => tab.id == id);
    if (index >= 0) {
      _select(index);
    }
  }

  void _openDiagnostics() => setState(() => _diagnostics = true);

  void _closeDiagnostics() => setState(() => _diagnostics = false);

  /// Back: leave diagnostics, then return to the first tab, then leave the app.
  bool get _canLeave => _index == 0 && !_diagnostics;

  @override
  Widget build(BuildContext context) {
    final TabSpec tab = widget.tabs[_index];
    final ShellActions actions = ShellActions(goTab: _goTab, openDiagnostics: _openDiagnostics);
    final bool diagnostics = _diagnostics;
    return HealthScope(
      monitor: _monitor,
      child: PopScope(
      canPop: _canLeave,
      onPopInvokedWithResult: (bool didPop, Object? result) {
        if (didPop) {
          return;
        }
        if (_diagnostics) {
          _closeDiagnostics();
        } else {
          _select(0);
        }
      },
      child: Scaffold(
        backgroundColor: N11Colors.bg,
        body: SafeArea(
          bottom: false,
          child: Column(
            children: <Widget>[
              if (diagnostics)
                N11AppBar(title: 'Chẩn đoán kết nối', onBack: _closeDiagnostics)
              else if (tab.showAppBar && tab.showLogo)
                N11AppBar(logo: BrandLogo(brand: widget.brand), title: tab.title)
              else if (tab.showAppBar)
                N11AppBar(title: tab.title),
              if (!diagnostics && !tab.ownsConnectionBanner) ConnectionBanner(monitor: _monitor),
              Expanded(
                // The tabs stay in the tree (offstage) while diagnostics is open, so what was typed in a tab is not lost.
                child: Stack(
                  fit: StackFit.expand,
                  children: <Widget>[
                    Offstage(
                      offstage: diagnostics,
                      child: IndexedStack(
                        index: _index,
                        children: <Widget>[
                          for (final TabSpec spec in widget.tabs)
                            if (spec.fullBleed)
                              Builder(key: Key('page-${spec.id}'), builder: (BuildContext context) => spec.body(context, actions))
                            else SingleChildScrollView(
                              key: Key('page-${spec.id}'),
                              padding: const EdgeInsets.fromLTRB(N11Space.pad, N11Space.gap4, N11Space.pad, N11Space.gap8),
                              child: Builder(builder: (BuildContext context) => spec.body(context, actions)),
                            ),
                        ],
                      ),
                    ),
                    if (diagnostics) DiagnosticsView(monitor: _monitor, brand: widget.brand, config: widget.config),
                  ],
                ),
              ),
            ],
          ),
        ),
        bottomNavigationBar: N11BottomNav(
          items: <NavItem>[for (final TabSpec spec in widget.tabs) NavItem(id: spec.id, label: spec.label, icon: spec.icon)],
          activeIndex: _index,
          onSelect: _select,
        ),
      ),
    ));
  }
}
