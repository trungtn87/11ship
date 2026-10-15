import 'dart:async';

import 'package:flutter/material.dart';

import 'brand.dart';
import 'config.dart';
import 'health.dart';
import 'tokens.dart';
import 'widgets/components.dart';
import 'widgets/connection_banner.dart';
import 'widgets/diagnostics_view.dart';

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
  const TabSpec({required this.id, required this.label, required this.icon, required this.title, required this.body, this.showLogo = false, this.fullBleed = false, this.showAppBar = true});

  final String id;
  final String label;
  final IconData icon;
  final String title;

  /// Home screens show the brand logo in the app bar instead of a centred title.
  final bool showLogo;
  /// Map-based screens own their layout and scrolling, without shell padding.
  final bool fullBleed;
  final bool showAppBar;
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
    this.pollInterval = const Duration(seconds: 30),
  });

  final AppBrand brand;
  final List<TabSpec> tabs;
  final AppConfig config;

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
      home: N11Shell(brand: brand, tabs: tabs, config: config, transport: transport, pollInterval: pollInterval),
    );
  }
}

class N11Shell extends StatefulWidget {
  const N11Shell({super.key, required this.brand, required this.tabs, required this.config, this.transport, this.pollInterval = const Duration(seconds: 30)});

  final AppBrand brand;
  final List<TabSpec> tabs;
  final AppConfig config;
  final HealthTransport? transport;
  final Duration pollInterval;

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
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
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
    return PopScope(
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
              if (!diagnostics) ConnectionBanner(monitor: _monitor),
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
    );
  }
}
