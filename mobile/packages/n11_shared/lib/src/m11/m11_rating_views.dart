import 'package:flutter/material.dart';

import '../m02/menu_models.dart';
import '../m07/m07_widgets.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import 'm11_complaint_views.dart';
import 'm11_models.dart';
import 'm11_source.dart';
import 'm11_widgets.dart';

// Rating screens of M11.01. A rating is sent once and cannot be edited or deleted, so the screen asks for a confirmation first; the operation
// key is kept while the outcome is unknown so a retry never rates twice. Nothing here shows a default star.

/// One rating form: stars, an optional comment, a confirmation, then the submit. Pops `true` when the server accepted it.
class RateScreen extends StatefulWidget {
  const RateScreen({super.key, required this.title, required this.subject, required this.submit, this.shipper});

  final String title;

  /// The shop or Shipper being rated, as the person sees it.
  final String subject;
  final RatedShipper? shipper;
  final Future<void> Function(int stars, String? comment, String key) submit;

  @override
  State<RateScreen> createState() => _RateScreenState();
}

class _RateScreenState extends State<RateScreen> with M07Actions<RateScreen> {
  int _stars = 0;
  final TextEditingController _comment = TextEditingController();

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final bool yes = await showConfirmDialog(
      context,
      title: 'Gửi đánh giá?',
      content: Text('Bạn chọn $_stars sao cho ${widget.subject}. Đánh giá chỉ gửi một lần và không sửa hoặc xóa được.', style: N11Text.lead),
      confirmLabel: 'Gửi đánh giá',
    );
    if (!yes || !mounted) {
      return;
    }
    final bool ok = await act('rate', (String key) => widget.submit(_stars, _comment.text, key));
    if (ok && mounted) {
      Navigator.of(context).pop(true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final RatedShipper? ship = widget.shipper;
    return m07Page(
      widget.title,
      false,
      <Widget>[
        N11Card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(widget.subject, key: const Key('m11-rate-subject'), style: N11Text.h2),
              if (ship != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('Mã ${ship.code}${ship.rating == null || ship.rating!.isEmpty ? ' · Chưa có đánh giá' : ' · ${m11Average(ship.rating!.average)} sao (${ship.rating!.count} lượt)'}', style: N11Text.caption)),
            ],
          ),
        ),
        N11Card(
          child: Column(
            children: <Widget>[
              M11StarPicker(value: _stars, enabled: !busy, onChanged: (int v) => setState(() => _stars = v)),
              const SizedBox(height: 4),
              Text(_stars == 0 ? 'Chạm vào sao để chọn' : kStarWords[_stars], key: const Key('m11-star-word'), style: N11Text.bodyStrong),
            ],
          ),
        ),
        M11TextBox(fieldKey: const Key('m11-rate-comment'), label: 'Nhận xét', optional: true, controller: _comment, enabled: !busy, hint: 'Chia sẻ trải nghiệm của bạn'),
        actionBanner(),
        N11Button(key: const Key('m11-rate-send'), label: 'Gửi đánh giá', loading: busy, onPressed: _stars == 0 || busy ? null : _send),
        if (_stars == 0) const Text('Hãy chọn số sao trước khi gửi.', textAlign: TextAlign.center, style: N11Text.caption),
      ],
    );
  }
}

/// A card that shows what the person rated, or the button to rate, or why they cannot.
class _RateTarget extends StatelessWidget {
  const _RateTarget({required this.keyPrefix, required this.title, required this.subtitle, required this.review, required this.canReview, required this.whyNot, required this.onRate});

  final String keyPrefix;
  final String title;
  final String subtitle;
  final OwnReview? review;
  final bool canReview;
  final String whyNot;
  final VoidCallback onRate;

  @override
  Widget build(BuildContext context) {
    final OwnReview? done = review;
    return N11Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(title, style: N11Text.label),
          const SizedBox(height: 2),
          Text(subtitle, style: N11Text.h2),
          const SizedBox(height: N11Space.gap2),
          if (done != null) ...<Widget>[
            Row(children: <Widget>[M11Stars(done.stars), const SizedBox(width: 8), Text('Đã đánh giá', key: Key('$keyPrefix-done'), style: N11Text.bodyStrong)]),
            if (done.comment != null && done.comment!.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(done.comment!, style: N11Text.body)),
          ] else if (canReview)
            N11Button(key: Key('$keyPrefix-rate'), label: 'Đánh giá', onPressed: onRate)
          else
            Text(whyNot, key: Key('$keyPrefix-why'), style: N11Text.caption),
        ],
      ),
    );
  }
}

/// Customer: rate the shop and the Shipper of one finished order. The screen is reached from the order (a reminder or the order detail); nothing
/// pops up by itself.
class CustomerOrderRatingScreen extends StatelessWidget {
  const CustomerOrderRatingScreen({super.key, required this.source, required this.orderId, required this.picker});

  final M11Source source;
  final String orderId;
  final ImagePickerPort picker;

  @override
  Widget build(BuildContext context) {
    return m07Page('Đánh giá đơn hàng', false, <Widget>[
      M07Loader<CustomerOrderReviewState>(
        keyPrefix: 'm11-customer-order',
        load: () => source.customerOrder(orderId),
        builder: (BuildContext context, CustomerOrderReviewState state, Future<void> Function() reload) {
          Future<void> rate(String title, String subject, RatedShipper? shipper, Future<void> Function(int, String?, String) submit) async {
            await Navigator.of(context).push<bool>(MaterialPageRoute<bool>(builder: (_) => RateScreen(title: title, subject: subject, shipper: shipper, submit: submit)));
            await reload();
          }

          return vstack(<Widget>[
            Text('Đơn ${state.orderCode}', style: N11Text.caption),
            _RateTarget(
              keyPrefix: 'm11-rate-shop',
              title: 'Quán',
              subtitle: state.shopName,
              review: state.shopReview,
              canReview: state.canReviewShop,
              whyNot: state.orderCompleted ? 'Chưa đánh giá được quán lúc này.' : 'Đơn hoàn thành rồi bạn mới đánh giá được quán.',
              onRate: () => rate('Đánh giá quán', state.shopName, null, (int s, String? c, String k) => source.customerRateShop(orderId, stars: s, comment: c, key: k)),
            ),
            if (state.shipper != null)
              _RateTarget(
                keyPrefix: 'm11-rate-shipper',
                title: 'Shipper',
                subtitle: state.shipper!.name,
                review: state.shipperReview,
                canReview: state.canReviewShipper,
                whyNot: 'Giao thành công rồi bạn mới đánh giá được shipper.',
                onRate: () => rate('Đánh giá shipper', state.shipper!.name, state.shipper, (int s, String? c, String k) => source.customerRateShipper(orderId, stars: s, comment: c, key: k)),
              )
            else
              const N11Card(child: Text('Đơn này chưa có shipper giao hoặc không giao qua shipper nên không có phần đánh giá shipper.', style: N11Text.caption)),
            N11Button(
              key: const Key('m11-order-complain'),
              label: 'Gửi phản ánh về đơn này',
              kind: ButtonKind.secondary,
              onPressed: () => Navigator.of(context).push<void>(MaterialPageRoute<void>(builder: (_) => ComplaintFormScreen(source: source, role: M11Role.customer, subject: ComplaintSubject.order(orderId), subjectLabel: 'Đơn ${state.orderCode}', picker: picker))),
            ),
          ]);
        },
      ),
    ]);
  }
}

/// Shop: rate the Shipper of one finished (done or failed) delivery.
class ShopDeliveryRatingScreen extends StatelessWidget {
  const ShopDeliveryRatingScreen({super.key, required this.source, required this.deliveryId, required this.picker});

  final M11Source source;
  final String deliveryId;
  final ImagePickerPort picker;

  @override
  Widget build(BuildContext context) {
    return m07Page('Đánh giá shipper', false, <Widget>[
      M07Loader<ShopDeliveryReviewState>(
        keyPrefix: 'm11-shop-delivery',
        load: () => source.shopDelivery(deliveryId),
        builder: (BuildContext context, ShopDeliveryReviewState state, Future<void> Function() reload) {
          final RatedShipper? shipper = state.shipper;
          return vstack(<Widget>[
            Text('Yêu cầu giao ${state.deliveryCode}', style: N11Text.caption),
            if (shipper == null)
              const N11Card(child: Text('Yêu cầu giao này chưa có shipper thực hiện nên chưa có gì để đánh giá.', key: Key('m11-shop-no-shipper'), style: N11Text.caption))
            else
              _RateTarget(
                keyPrefix: 'm11-shop-rate',
                title: 'Shipper thực hiện',
                subtitle: shipper.name,
                review: state.review,
                canReview: state.canReview,
                whyNot: 'Giao xong hoặc giao không thành công rồi quán mới đánh giá được shipper.',
                onRate: () async {
                  await Navigator.of(context).push<bool>(MaterialPageRoute<bool>(
                    builder: (_) => RateScreen(title: 'Đánh giá shipper', subject: shipper.name, shipper: shipper, submit: (int s, String? c, String k) => source.shopRateShipper(deliveryId, stars: s, comment: c, key: k)),
                  ));
                  await reload();
                },
              ),
            N11Button(
              key: const Key('m11-delivery-complain'),
              label: 'Gửi phản ánh về yêu cầu giao này',
              kind: ButtonKind.secondary,
              onPressed: () => Navigator.of(context).push<void>(MaterialPageRoute<void>(builder: (_) => ComplaintFormScreen(source: source, role: M11Role.shop, subject: ComplaintSubject.delivery(deliveryId), subjectLabel: 'Yêu cầu giao ${state.deliveryCode}', picker: picker))),
            ),
          ]);
        },
      ),
    ]);
  }
}

/// One shop review card (public page and the shop's own page).
class ShopReviewCard extends StatelessWidget {
  const ShopReviewCard({super.key, required this.review, this.onReply});

  final ShopReview review;

  /// Only the shop's own page passes this.
  final VoidCallback? onReply;

  @override
  Widget build(BuildContext context) {
    final ShopReply? reply = review.reply;
    return N11Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(child: Text(review.reviewerName, style: N11Text.bodyStrong)),
              Text(m11Date(review.createdAt), style: N11Text.caption),
            ],
          ),
          const SizedBox(height: 4),
          M11Stars(review.stars, size: 16),
          if (review.comment != null && review.comment!.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(review.comment!, style: N11Text.body)),
          if (reply != null)
            Container(
              key: Key('m11-reply-${review.reviewId}'),
              margin: const EdgeInsets.only(top: N11Space.gap3),
              padding: const EdgeInsets.all(N11Space.gap3),
              decoration: BoxDecoration(color: N11Colors.bg, borderRadius: BorderRadius.circular(kRadiusControl)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('Phản hồi của quán · ${m11Date(reply.updatedAt)}', style: N11Text.label),
                  const SizedBox(height: 2),
                  Text(reply.body, style: N11Text.body),
                ],
              ),
            ),
          if (onReply != null)
            Padding(
              padding: const EdgeInsets.only(top: N11Space.gap3),
              child: Align(alignment: Alignment.centerLeft, child: N11Button(key: Key('m11-reply-btn-${review.reviewId}'), label: reply == null ? 'Phản hồi' : 'Sửa phản hồi', kind: ButtonKind.secondary, compact: true, onPressed: onReply)),
            ),
        ],
      ),
    );
  }
}

/// The ratings of a shop: the public page (any signed-in person) or, with [own], the shop's page with the reply button.
class ShopReviewsScreen extends StatefulWidget {
  const ShopReviewsScreen({super.key, required this.source, this.shopId, this.title = 'Đánh giá quán'});

  final M11Source source;

  /// Null = the signed-in shop's own reviews (with replies).
  final String? shopId;
  final String title;

  @override
  State<ShopReviewsScreen> createState() => _ShopReviewsScreenState();
}

class _ShopReviewsScreenState extends State<ShopReviewsScreen> {
  int? _stars;

  @override
  Widget build(BuildContext context) {
    final bool own = widget.shopId == null;
    return m07Page(widget.title, false, <Widget>[
      M07Loader<ShopReviewPage>(
        key: ValueKey<int?>(_stars),
        keyPrefix: 'm11-shop-reviews',
        load: () => own ? widget.source.shopReviews(stars: _stars) : widget.source.publicShopReviews(widget.shopId!, stars: _stars),
        builder: (BuildContext context, ShopReviewPage page, Future<void> Function() reload) {
          return vstack(<Widget>[
            M11SummaryCard(summary: page.summary, title: page.shopName),
            if (!page.summary.isEmpty || _stars != null) M11StarFilter(value: _stars, onChanged: (int? v) => setState(() => _stars = v)),
            if (page.items.isEmpty)
              EmptyState(key: const Key('m11-shop-reviews-none'), icon: Icons.star_outline_rounded, title: _stars == null ? 'Chưa có đánh giá' : 'Không có đánh giá $_stars sao', text: _stars == null ? 'Đánh giá của khách sẽ hiện ở đây.' : 'Thử chọn mức sao khác.')
            else
              for (final ShopReview r in page.items)
                ShopReviewCard(
                  review: r,
                  onReply: !own
                      ? null
                      : () async {
                          await Navigator.of(context).push<bool>(MaterialPageRoute<bool>(builder: (_) => ReplyScreen(source: widget.source, review: r)));
                          await reload();
                        },
                ),
          ]);
        },
      ),
    ]);
  }
}

/// The shop writes or updates its one reply to a rating (earlier texts are kept by the server as history).
class ReplyScreen extends StatefulWidget {
  const ReplyScreen({super.key, required this.source, required this.review});

  final M11Source source;
  final ShopReview review;

  @override
  State<ReplyScreen> createState() => _ReplyScreenState();
}

class _ReplyScreenState extends State<ReplyScreen> with M07Actions<ReplyScreen> {
  late final TextEditingController _body = TextEditingController(text: widget.review.reply?.body ?? '');

  @override
  void dispose() {
    _body.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final bool ok = await act('reply', (String key) => widget.source.saveReply(widget.review.reviewId, body: _body.text.trim(), expectedVersion: widget.review.reply?.version, key: key));
    if (ok && mounted) {
      Navigator.of(context).pop(true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bool ready = _body.text.trim().isNotEmpty;
    return m07Page(
      widget.review.reply == null ? 'Phản hồi đánh giá' : 'Sửa phản hồi',
      false,
      <Widget>[
        ShopReviewCard(review: ShopReview(reviewId: widget.review.reviewId, reviewerName: widget.review.reviewerName, stars: widget.review.stars, comment: widget.review.comment, createdAt: widget.review.createdAt, reply: null)),
        M11TextBox(fieldKey: const Key('m11-reply-body'), label: 'Phản hồi của quán', controller: _body, enabled: !busy, onChanged: () => setState(() {})),
        const Text('Quán không sửa hoặc xóa được đánh giá của khách. Phản hồi cũ được lưu lại khi bạn cập nhật.', style: N11Text.caption),
        actionBanner(),
        N11Button(
          key: const Key('m11-reply-save'),
          label: 'Lưu phản hồi',
          loading: busy,
          onPressed: !ready || busy ? null : _save,
        ),
      ],
    );
  }
}

/// Shipper: the scores about them by source (customers / shops), their comments and the button to file a complaint about a rating.
class ShipperReviewsScreen extends StatefulWidget {
  const ShipperReviewsScreen({super.key, required this.source, required this.picker});

  final M11Source source;
  final ImagePickerPort picker;

  @override
  State<ShipperReviewsScreen> createState() => _ShipperReviewsScreenState();
}

class _ShipperReviewsScreenState extends State<ShipperReviewsScreen> {
  ReviewSource? _source;
  int? _stars;

  @override
  Widget build(BuildContext context) {
    return m07Page('Đánh giá của tôi', false, <Widget>[
      M07Loader<ShipperReviewPage>(
        key: ValueKey<String>('$_source/$_stars'),
        keyPrefix: 'm11-shipper-reviews',
        load: () => widget.source.shipperReviews(source: _source, stars: _stars),
        builder: (BuildContext context, ShipperReviewPage page, Future<void> Function() reload) {
          final RatingSummary shown = switch (_source) {
            null => page.all,
            ReviewSource.customer => page.fromCustomers,
            ReviewSource.shop => page.fromShops,
          };
          return vstack(<Widget>[
            M11SummaryCard(summary: shown, title: switch (_source) { null => 'Tất cả nguồn', ReviewSource.customer => 'Khách đánh giá', ReviewSource.shop => 'Quán đánh giá' }),
            Wrap(
              spacing: N11Space.gap2,
              children: <Widget>[
                for (final (ReviewSource? s, String label) in <(ReviewSource?, String)>[(null, 'Tất cả'), (ReviewSource.customer, 'Khách'), (ReviewSource.shop, 'Quán')])
                  ChoiceChip(
                    key: Key('m11-source-${s?.name ?? 'all'}'),
                    label: Text(label),
                    selected: _source == s,
                    onSelected: (bool _) => setState(() => _source = s),
                  ),
              ],
            ),
            M11StarFilter(value: _stars, onChanged: (int? v) => setState(() => _stars = v)),
            if (page.items.isEmpty)
              const EmptyState(key: Key('m11-shipper-reviews-none'), icon: Icons.star_outline_rounded, title: 'Chưa có đánh giá', text: 'Đánh giá về bạn sẽ hiện ở đây.')
            else
              for (final ShipperReview r in page.items) _shipperCard(context, r, reload),
          ]);
        },
      ),
    ]);
  }

  Widget _shipperCard(BuildContext context, ShipperReview r, Future<void> Function() reload) {
    final ReviewComplaintRef? c = r.complaint;
    return N11Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              M11Stars(r.stars, size: 16),
              N11Chip(r.source == ReviewSource.customer ? 'Khách đánh giá' : 'Quán đánh giá'),
              Text(m11Date(r.createdAt), style: N11Text.caption),
            ],
          ),
          if (r.comment != null && r.comment!.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(r.comment!, style: N11Text.body)),
          const SizedBox(height: N11Space.gap2),
          if (c != null)
            Row(children: <Widget>[Text('Phản ánh ${c.code}', style: N11Text.caption), const SizedBox(width: 8), N11Chip(m11StatusChip(c.status).label, kind: m11StatusChip(c.status).kind)])
          else
            Align(
              alignment: Alignment.centerLeft,
              child: N11Button(
                key: Key('m11-review-complain-${r.reviewId}'),
                label: 'Phản ánh đánh giá',
                kind: ButtonKind.secondary,
                compact: true,
                onPressed: () async {
                  await Navigator.of(context).push<void>(MaterialPageRoute<void>(builder: (_) => ComplaintFormScreen(source: widget.source, role: M11Role.shipper, subject: ComplaintSubject.review(r.reviewId), subjectLabel: 'Đánh giá ${r.stars} sao', picker: widget.picker)));
                  await reload();
                },
              ),
            ),
        ],
      ),
    );
  }
}
