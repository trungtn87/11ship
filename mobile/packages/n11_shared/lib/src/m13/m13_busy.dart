import '../account/session_controller.dart';
import '../m10/m10_models.dart';
import '../m10/m10_source.dart';

// M13 (#193): "is this person in the middle of work an update must not cover?" for the shop owner of 11Food, read from the SERVER's own order counts.
// Orders the shop has accepted and is handling (preparing, scheduled, being delivered, needing attention) are work in hand. Orders still waiting to be
// accepted are not: the shop has not started them, and from the moment an update is required it cannot start them (see OrderRuntime.newWorkBlocked), so
// they must not hold the update back for ever.
//
// What this never does is guess "idle": a session that is not yet known, or an answer that could not be read, throws, and the update controller counts a
// failing probe as busy. Only a known guest (nobody signed in) and a signed-in account that has no shop are reported as free.

/// Whether the shop's own orders in progress exist. Throws when that cannot be determined (the caller treats that as busy).
Future<bool> shopOwnerBusy({
  required SessionStatus status,
  required List<String>? roles,
  required Future<ShopOrderCounts> Function() counts,
}) async {
  if (status == SessionStatus.guest) {
    return false;
  }
  if (status != SessionStatus.signedIn || roles == null) {
    throw StateError('session not known yet');
  }
  if (!roles.contains('SHOP_OWNER')) {
    return false;
  }
  final ShopOrderCounts c = await counts();
  return c.preparing + c.scheduled + c.delivering + c.attention > 0;
}

/// The probe of a build whose shop orders come from [source]. The first page is not needed: the counts come with every list answer.
Future<bool> Function() shopBusyProbe(SessionController session, ShopOrderSource source) => () => shopOwnerBusy(
      status: session.status,
      roles: session.identity?.availableRoles,
      counts: () async => (await source.list(filter: 'pending')).counts,
    );
