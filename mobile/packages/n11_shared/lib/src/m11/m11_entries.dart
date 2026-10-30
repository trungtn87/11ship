import 'package:flutter/material.dart';

import '../account/session_controller.dart';
import '../m02/menu_models.dart';
import '../m07/m07_models.dart';
import '../m07/m07_widgets.dart';
import '../account/account_views.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import 'm11_complaint_views.dart';
import 'm11_models.dart';
import 'm11_rating_views.dart';
import 'm11_source.dart';

// Where the M11 screens are reached from. There is NO new tab: ratings and complaints live under a finished delivery and under Account.

/// The shop's block under a finished delivery: rate the Shipper (when there is one) and send a complaint.
M07FeedbackSlot shopDeliveryFeedbackSlot({required M11Source source, required ImagePickerPort picker}) => (BuildContext context, DeliveryView d) {
      return N11Card(
        key: const Key('m11-shop-feedback'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            const Text('Đánh giá và phản ánh', style: N11Text.label),
            const SizedBox(height: N11Space.gap2),
            if (d.assignment != null && (d.state == DeliveryState.completed || d.state == DeliveryState.failed))
              N11Button(
                key: const Key('m11-shop-rate-shipper'),
                label: 'Đánh giá shipper',
                kind: ButtonKind.secondary,
                onPressed: () => Navigator.of(context).push<void>(n11Route(ShopDeliveryRatingScreen(source: source, deliveryId: d.deliveryId, picker: picker))),
              ),
            if (d.assignment != null && (d.state == DeliveryState.completed || d.state == DeliveryState.failed)) const SizedBox(height: N11Space.gap2),
            N11Button(
              key: const Key('m11-shop-complain'),
              label: 'Gửi phản ánh',
              kind: ButtonKind.secondary,
              onPressed: () => Navigator.of(context).push<void>(n11Route(ComplaintFormScreen(source: source, role: M11Role.shop, subject: ComplaintSubject.delivery(d.deliveryId), subjectLabel: 'Yêu cầu giao ${d.code}', picker: picker))),
            ),
          ],
        ),
      );
    };

/// The customer's block under a finished customer delivery: rate the Shipper and send a complaint.
M07FeedbackSlot customerDeliveryFeedbackSlot({required M11Source source, required ImagePickerPort picker}) => (BuildContext context, DeliveryView d) {
      return N11Card(
        key: const Key('m11-customer-delivery-feedback'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            const Text('Đánh giá và phản ánh', style: N11Text.label),
            const SizedBox(height: N11Space.gap2),
            if (d.assignment != null && d.state == DeliveryState.completed)
              N11Button(
                key: const Key('m11-customer-rate-shipper'),
                label: 'Đánh giá shipper',
                kind: ButtonKind.secondary,
                onPressed: () => Navigator.of(context).push<void>(n11Route(CustomerDeliveryRatingScreen(source: source, deliveryId: d.deliveryId, picker: picker))),
              ),
            if (d.assignment != null && d.state == DeliveryState.completed) const SizedBox(height: N11Space.gap2),
            N11Button(
              key: const Key('m11-customer-delivery-complain'),
              label: 'Gửi phản ánh',
              kind: ButtonKind.secondary,
              onPressed: () => Navigator.of(context).push<void>(n11Route(ComplaintFormScreen(source: source, role: M11Role.customer, subject: ComplaintSubject.delivery(d.deliveryId), subjectLabel: 'Chuyến giao ${d.code}', picker: picker))),
            ),
          ],
        ),
      );
    };

/// The Shipper's block under a finished delivery: send a complaint about it.
M07FeedbackSlot shipperDeliveryFeedbackSlot({required M11Source source, required ImagePickerPort picker}) => (BuildContext context, DeliveryView d) {
      return N11Card(
        key: const Key('m11-shipper-feedback'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            const Text('Phản ánh', style: N11Text.label),
            const SizedBox(height: N11Space.gap2),
            N11Button(
              key: const Key('m11-shipper-complain'),
              label: 'Gửi phản ánh về lần giao này',
              kind: ButtonKind.secondary,
              onPressed: () => Navigator.of(context).push<void>(n11Route(ComplaintFormScreen(source: source, role: M11Role.shipper, subject: ComplaintSubject.delivery(d.deliveryId), subjectLabel: 'Lần giao ${d.code}', picker: picker))),
            ),
          ],
        ),
      );
    };

/// Rows of the Account tab: "Phản ánh của tôi" for everybody, plus the shop's customer ratings or the Shipper's scores.
List<Widget> m11AccountEntries(BuildContext context, {required M11Source source, required ImagePickerPort picker, required M11Role role}) {
  return <Widget>[
    if (role == M11Role.shop)
      N11ListItem(key: const Key('open-shop-reviews'), icon: Icons.star_outline_rounded, title: 'Đánh giá của khách', sub: 'Xem đánh giá quán và phản hồi', onTap: () => Navigator.of(context).push<void>(n11Route(ShopReviewsScreen(source: source, title: 'Đánh giá của khách')))),
    if (role == M11Role.shipper)
      N11ListItem(key: const Key('open-shipper-reviews'), icon: Icons.star_outline_rounded, title: 'Đánh giá của tôi', sub: 'Điểm theo nguồn khách và quán', onTap: () => Navigator.of(context).push<void>(n11Route(ShipperReviewsScreen(source: source, picker: picker)))),
    N11ListItem(key: const Key('open-complaints'), icon: Icons.flag_outlined, title: 'Phản ánh của tôi', sub: 'Theo dõi, bổ sung và xem kết quả', onTap: () => Navigator.of(context).push<void>(n11Route(ComplaintsScreen(source: source, role: role, picker: picker)))),
  ];
}

/// The notification target "complaint": opens the file, which loads the CURRENT state and decides the right again (a person who lost the right sees a refusal).
Widget complaintRoute({required M11Source source, required M11Role role, required String complaintId, required ImagePickerPort picker}) =>
    ComplaintDetailScreen(source: source, role: role, complaintId: complaintId, picker: picker);

/// Which M11 role the signed-in person has in this app: Food = shop owner (or customer), Ship = Shipper.
M11Role m11RoleOf(SessionController session, {required bool shipApp}) {
  if (shipApp) {
    return M11Role.shipper;
  }
  return session.identity?.availableRoles.contains('SHOP_OWNER') == true ? M11Role.shop : M11Role.customer;
}

/// The customer's block under a finished order: rate the shop and the Shipper, or send a complaint. The server decides what is possible (an unfinished
/// order, somebody else's order and a second rating are refused there) and the screen says it in words.
Widget customerOrderFeedbackCard(BuildContext context, {required M11Source source, required ImagePickerPort picker, required String orderId, required String orderCode}) {
  return N11Card(
    key: const Key('m11-customer-feedback'),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const Text('Đánh giá và phản ánh', style: N11Text.label),
        const SizedBox(height: N11Space.gap2),
        N11Button(
          key: const Key('m11-customer-rate'),
          label: 'Đánh giá đơn hàng',
          kind: ButtonKind.secondary,
          onPressed: () => Navigator.of(context).push<void>(n11Route(CustomerOrderRatingScreen(source: source, orderId: orderId, picker: picker))),
        ),
        const SizedBox(height: N11Space.gap2),
        N11Button(
          key: const Key('m11-customer-complain'),
          label: 'Gửi phản ánh',
          kind: ButtonKind.secondary,
          onPressed: () => Navigator.of(context).push<void>(n11Route(ComplaintFormScreen(source: source, role: M11Role.customer, subject: ComplaintSubject.order(orderId), subjectLabel: 'Đơn $orderCode', picker: picker))),
        ),
      ],
    ),
  );
}
