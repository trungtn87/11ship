import 'm10_models.dart';

// The 3-step progress of a customer's food order (Figma F03A mẫu 3: Xác nhận → Chuẩn bị → Giao hàng). It is a PRESENTATION of the server's
// DisplayStatus only: the phone never marks a step done on its own, and a step the server has not reached is never drawn as a check mark.
// Mapping (Owner-approved statuses, see DisplayStatus in m10_models.dart; no status is added here):
//   AWAITING_SHOP                                   -> waiting, pending, pending   (step 1 is WAITING: no check)
//   PREPARING (and an older READY, read as PREPARING) -> done, current, pending
//   SEARCHING_SHIPPER / SHIPPER_COMING / DELIVERING -> done, done, current         ("Gọi shipper" is only possible once the dishes are ready)
//   SEARCH_STOPPED / DELIVERY_FAILED                -> done, done, stalled         (the order is still open; the shop keeps handling it)
//   COMPLETED                                       -> done, done, done
//   CANCELLED_* / REJECTED / NOT_COMPLETED          -> null: the order ended before or without finishing, so no progress is drawn
//                                                      (it never reads as "Đã giao").

/// The state of one step.
enum OrderStepState {
  /// Finished (a check mark).
  done,

  /// Happening now.
  current,

  /// Waiting for the shop to act (step 1 while AWAITING_SHOP): a ring, never a check.
  waiting,

  /// Not reached yet.
  pending,

  /// The order is open but this step cannot move on for now (search stopped / delivery failed).
  stalled,
}

const List<String> kCustomerProgressLabels = <String>['Xác nhận', 'Chuẩn bị', 'Giao hàng'];

/// Progress of an open or completed order: exactly three states, in the order of [kCustomerProgressLabels].
class CustomerOrderProgress {
  const CustomerOrderProgress(this.steps);

  final List<OrderStepState> steps;

  /// Words for a screen reader, e.g. "Xác nhận: đã xong; Chuẩn bị: đang thực hiện; Giao hàng: chưa đến".
  String get semanticsLabel {
    String word(OrderStepState s) => switch (s) {
          OrderStepState.done => 'đã xong',
          OrderStepState.current => 'đang thực hiện',
          OrderStepState.waiting => 'đang chờ',
          OrderStepState.pending => 'chưa đến',
          OrderStepState.stalled => 'đang bị dừng',
        };
    return <String>[for (int i = 0; i < 3; i++) '${kCustomerProgressLabels[i]}: ${word(steps[i])}'].join('; ');
  }
}

/// The progress of a food order, or null when the order has ended without completing (no progress is drawn for it).
CustomerOrderProgress? customerProgressOf(DisplayStatus status) => switch (status) {
      DisplayStatus.awaitingShop => const CustomerOrderProgress(<OrderStepState>[OrderStepState.waiting, OrderStepState.pending, OrderStepState.pending]),
      DisplayStatus.preparing => const CustomerOrderProgress(<OrderStepState>[OrderStepState.done, OrderStepState.current, OrderStepState.pending]),
      DisplayStatus.searchingShipper || DisplayStatus.shipperComing || DisplayStatus.delivering =>
        const CustomerOrderProgress(<OrderStepState>[OrderStepState.done, OrderStepState.done, OrderStepState.current]),
      DisplayStatus.searchStopped || DisplayStatus.deliveryFailed =>
        const CustomerOrderProgress(<OrderStepState>[OrderStepState.done, OrderStepState.done, OrderStepState.stalled]),
      DisplayStatus.completed => const CustomerOrderProgress(<OrderStepState>[OrderStepState.done, OrderStepState.done, OrderStepState.done]),
      DisplayStatus.cancelledByCustomer ||
      DisplayStatus.cancelledByShop ||
      DisplayStatus.cancelledBySystem ||
      DisplayStatus.rejected ||
      DisplayStatus.notCompleted =>
        null,
    };
