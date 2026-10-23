import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../m02/menu_models.dart';
import '../m07/m07_source.dart';
import '../m07/m07_widgets.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import 'm11_models.dart';
import 'm11_source.dart';
import 'm11_widgets.dart';

// Complaint screens of M11.02: file (category, text, up to 5 pictures), follow ("Phản ánh của tôi"), supplement and ask for a reconsideration.
// The server is the source of truth: the screens show what it sent (status, who is awaited, whether a reconsideration is still possible) and
// never count days or guess a status. A write keeps its operation key until the server answered, so a retry never files twice.

const int kMaxEvidence = 5;

/// The evidence pictures of one line of the thread, loaded from the server only when the person opens the file (the server checks the right for each
/// picture; a refused or lost one says so, it never shows a broken image). Tapping one enlarges it.
class EvidenceThumbs extends StatelessWidget {
  const EvidenceThumbs({super.key, required this.source, required this.role, required this.pictures});

  final M11Source source;
  final M11Role role;
  final List<EvidenceRef> pictures;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: N11Space.gap2,
      runSpacing: N11Space.gap2,
      children: <Widget>[for (final EvidenceRef p in pictures) _Thumb(key: Key('m11-evidence-${p.id}'), source: source, role: role, id: p.id)],
    );
  }
}

class _Thumb extends StatefulWidget {
  const _Thumb({super.key, required this.source, required this.role, required this.id});

  final M11Source source;
  final M11Role role;
  final String id;

  @override
  State<_Thumb> createState() => _ThumbState();
}

class _ThumbState extends State<_Thumb> {
  late Future<Uint8List> _bytes = widget.source.evidencePicture(widget.role, widget.id);

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Uint8List>(
      future: _bytes,
      builder: (BuildContext context, AsyncSnapshot<Uint8List> snapshot) {
        const double size = 88;
        if (snapshot.hasError) {
          return SizedBox(
            width: size,
            height: size,
            child: InkWell(
              key: Key('m11-evidence-retry-${widget.id}'),
              borderRadius: BorderRadius.circular(kRadiusControl),
              onTap: () => setState(() {
                _bytes = widget.source.evidencePicture(widget.role, widget.id);
              }),
              child: Container(
                alignment: Alignment.center,
                decoration: BoxDecoration(color: N11Colors.errorSoft, borderRadius: BorderRadius.circular(kRadiusControl)),
                child: const Text('Không tải được.\nChạm để thử lại', textAlign: TextAlign.center, style: TextStyle(fontSize: 11, color: N11Colors.errorInk)),
              ),
            ),
          );
        }
        final Uint8List? data = snapshot.data;
        if (data == null) {
          return const SizedBox(width: size, height: size, child: Center(child: CircularProgressIndicator(strokeWidth: 2)));
        }
        return InkWell(
          borderRadius: BorderRadius.circular(kRadiusControl),
          onTap: () => showDialog<void>(context: context, builder: (BuildContext dialogContext) => Dialog(child: InteractiveViewer(child: Image.memory(data, fit: BoxFit.contain, semanticLabel: 'Ảnh minh chứng')))),
          child: ClipRRect(borderRadius: BorderRadius.circular(kRadiusControl), child: Image.memory(data, width: size, height: size, fit: BoxFit.cover, semanticLabel: 'Ảnh minh chứng', errorBuilder: (BuildContext c, Object e, StackTrace? s) => const SizedBox(width: size, height: size, child: Icon(Icons.broken_image_outlined)))),
        );
      },
    );
  }
}

/// Evidence pictures chosen on the phone: each is uploaded on choosing, and its id kept so that a retry of the submit sends the same ones.
class _EvidenceBox extends StatelessWidget {
  const _EvidenceBox({required this.count, required this.busy, required this.onAdd, required this.onRemoveLast, this.failure});

  final int count;
  final bool busy;
  final VoidCallback onAdd;
  final VoidCallback onRemoveLast;
  final String? failure;

  @override
  Widget build(BuildContext context) {
    return N11Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text('Ảnh minh chứng · không bắt buộc', style: N11Text.label),
          const SizedBox(height: 2),
          Text('Tối đa $kMaxEvidence ảnh, mỗi ảnh 5 MB.', style: N11Text.caption),
          const SizedBox(height: N11Space.gap2),
          Text(count == 0 ? 'Chưa chọn ảnh nào' : 'Đã chọn $count ảnh', key: const Key('m11-evidence-count'), style: N11Text.bodyStrong),
          if (failure != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(failure!, key: const Key('m11-evidence-failed'), style: const TextStyle(fontSize: 13, color: N11Colors.errorInk, fontWeight: FontWeight.w600))),
          const SizedBox(height: N11Space.gap2),
          Wrap(
            spacing: N11Space.gap2,
            runSpacing: N11Space.gap2,
            children: <Widget>[
              N11Button(key: const Key('m11-evidence-add'), label: 'Thêm ảnh', icon: Icons.add_photo_alternate_outlined, kind: ButtonKind.secondary, compact: true, onPressed: busy || count >= kMaxEvidence ? null : onAdd),
              if (count > 0) N11Button(key: const Key('m11-evidence-remove'), label: 'Bỏ ảnh cuối', kind: ButtonKind.secondary, compact: true, onPressed: busy ? null : onRemoveLast),
            ],
          ),
        ],
      ),
    );
  }
}

/// Picks and uploads evidence pictures one by one; shared by the form and the supplement screen.
mixin _EvidenceUploads<T extends StatefulWidget> on State<T> {
  final List<String> evidenceIds = <String>[];
  String? evidenceFailure;
  bool uploading = false;

  M11Source get evidenceSource;
  M11Role get evidenceRole;
  ImagePickerPort get evidencePicker;

  Future<void> addEvidence() async {
    if (uploading || evidenceIds.length >= kMaxEvidence) {
      return;
    }
    setState(() {
      uploading = true;
      evidenceFailure = null;
    });
    String? failure;
    try {
      final PickedImage? image = await evidencePicker.pick();
      if (image != null) {
        evidenceIds.add(await evidenceSource.uploadEvidence(evidenceRole, image));
      }
    } on ImagePickException {
      failure = 'Không đọc được ảnh này. Hãy chọn ảnh JPEG, PNG hoặc WebP khác.';
    } on M07Failure catch (error) {
      failure = error.code == null && error.kind == M07FailureKind.offline ? 'Chưa tải ảnh lên được vì mất kết nối. Hãy thử lại.' : error.message;
    } on Object {
      failure = 'Chưa tải ảnh lên được. Hãy thử lại.';
    }
    if (mounted) {
      setState(() {
        uploading = false;
        evidenceFailure = failure;
      });
    }
  }

  void removeLastEvidence() => setState(() {
        if (evidenceIds.isNotEmpty) {
          evidenceIds.removeLast();
        }
      });
}

/// Category choices: the order/delivery groups, or the single "Đánh giá shipper" group for a complaint about a rating.
List<ComplaintCategory> _categoriesFor(ComplaintSubject subject) => subject.reviewId != null
    ? const <ComplaintCategory>[ComplaintCategory.shipperReview]
    : const <ComplaintCategory>[ComplaintCategory.deliveryResult, ComplaintCategory.goods, ComplaintCategory.moneyFee, ComplaintCategory.service, ComplaintCategory.other];

/// The complaint form. The related code is attached by the app; the server checks that the person is really a party of it.
class ComplaintFormScreen extends StatefulWidget {
  const ComplaintFormScreen({super.key, required this.source, required this.role, required this.subject, required this.subjectLabel, required this.picker});

  final M11Source source;
  final M11Role role;
  final ComplaintSubject subject;

  /// "Đơn OD-123", "Yêu cầu giao SH-45" or "Đánh giá 2 sao": what the complaint is about.
  final String subjectLabel;
  final ImagePickerPort picker;

  @override
  State<ComplaintFormScreen> createState() => _ComplaintFormScreenState();
}

class _ComplaintFormScreenState extends State<ComplaintFormScreen> with M07Actions<ComplaintFormScreen>, _EvidenceUploads<ComplaintFormScreen> {
  late final List<ComplaintCategory> _categories = _categoriesFor(widget.subject);
  late ComplaintCategory? _category = _categories.length == 1 ? _categories.first : null;
  final TextEditingController _body = TextEditingController();

  @override
  M11Source get evidenceSource => widget.source;
  @override
  M11Role get evidenceRole => widget.role;
  @override
  ImagePickerPort get evidencePicker => widget.picker;

  @override
  void dispose() {
    _body.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    ComplaintFiled? filed;
    final bool ok = await act('file', (String key) async {
      filed = await widget.source.fileComplaint(widget.role, subject: widget.subject, category: _category!, body: _body.text, attachmentIds: List<String>.of(evidenceIds), key: key);
    });
    final ComplaintFiled? result = filed;
    if (ok && result != null && mounted) {
      final NavigatorState navigator = Navigator.of(context);
      navigator.pushReplacement(MaterialPageRoute<void>(builder: (_) => ComplaintDetailScreen(source: widget.source, role: widget.role, complaintId: result.complaint.id, picker: widget.picker, notice: result.appended ? 'Vấn đề này đang có hồ sơ mở nên nội dung của bạn đã được bổ sung vào hồ sơ đó.' : 'Đã gửi phản ánh. Chúng tôi sẽ cập nhật trạng thái ngay trong ứng dụng.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final bool needsText = _body.text.trim().isEmpty;
    final bool locked = busy || uploading;
    return m07Page(
      'Gửi phản ánh',
      false,
      <Widget>[
        N11Card(child: Row(children: <Widget>[const Icon(Icons.link, size: 18, color: N11Colors.ink2), const SizedBox(width: 8), Expanded(child: Text(widget.subjectLabel, key: const Key('m11-complaint-subject'), style: N11Text.bodyStrong))])),
        if (_categories.length > 1)
          N11Card(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Text('Nhóm vấn đề', style: N11Text.label),
                const SizedBox(height: N11Space.gap2),
                Wrap(
                  spacing: N11Space.gap2,
                  runSpacing: N11Space.gap2,
                  children: <Widget>[
                    for (final ComplaintCategory c in _categories)
                      ChoiceChip(key: Key('m11-category-${c.wire}'), label: Text(c.label), selected: _category == c, onSelected: locked ? null : (bool _) => setState(() => _category = c)),
                  ],
                ),
              ],
            ),
          ),
        M11TextBox(
          maxLength: 4000,
          fieldKey: const Key('m11-complaint-body'),
          label: 'Nội dung',
          controller: _body,
          enabled: !locked,
          onChanged: () => setState(() {}),
          hint: _category == ComplaintCategory.other ? 'Nhóm Khác: hãy mô tả rõ vấn đề' : 'Mô tả điều đã xảy ra',
        ),
        _EvidenceBox(count: evidenceIds.length, busy: locked, onAdd: addEvidence, onRemoveLast: removeLastEvidence, failure: evidenceFailure),
        actionBanner(),
        N11Button(key: const Key('m11-complaint-send'), validate: true, label: 'Gửi phản ánh', loading: busy, onPressed: _category == null || locked ? null : _send),
        if (_category == null) const Text('Hãy chọn nhóm vấn đề.', textAlign: TextAlign.center, style: N11Text.caption) else if (needsText) const Text('Hãy nhập nội dung phản ánh.', textAlign: TextAlign.center, style: N11Text.caption),
      ],
    );
  }
}

String _kindLabel(ThreadLine line) => switch (line.kind) {
      'SUBMITTED' => line.mine ? 'Bạn đã gửi' : 'Nội dung phản ánh',
      'APPENDED' || 'SUPPLEMENT' => line.mine ? 'Bạn bổ sung' : 'Bổ sung',
      'PARTY_RESPONSE' => line.mine ? 'Bạn giải trình' : 'Giải trình',
      'RECEIVED' => 'Đã tiếp nhận',
      'REQUEST_INFO' => 'Yêu cầu bổ sung',
      'CONCLUSION' => 'Kết luận',
      'CLOSED' => 'Đã đóng',
      'REOPEN_REQUEST' => 'Yêu cầu xem xét lại',
      'REOPEN_DECISION' => 'Quyết định xem xét lại',
      _ => 'Cập nhật',
    };

/// One complaint: status, what the Administration waits for, the thread, the conclusion and the actions the SERVER allows.
class ComplaintDetailScreen extends StatelessWidget {
  const ComplaintDetailScreen({super.key, required this.source, required this.role, required this.complaintId, required this.picker, this.notice});

  final M11Source source;
  final M11Role role;
  final String complaintId;
  final ImagePickerPort picker;

  /// One line shown above the file (for example after filing).
  final String? notice;

  @override
  Widget build(BuildContext context) {
    return M07DetailPage<ComplaintDetail>(
      title: 'Hồ sơ phản ánh',
      sample: false,
      keyPrefix: 'm11-complaint',
      refreshEvery: const Duration(seconds: 30),
      load: () => source.complaint(role, complaintId),
      builder: (BuildContext context, ComplaintDetail d, Future<void> Function() reload) {
        final ({String label, ChipKind kind}) chip = m11StatusChip(d.status);
        final bool expired = d.status.isClosed && !d.canRequestReconsideration && d.reconsiderationExpiresAt != null && !d.serverNow.isBefore(d.reconsiderationExpiresAt!) && d.reconsiderations.isEmpty;
        return M07PageParts(<Widget>[
          if (notice != null) N11Banner(key: const Key('m11-complaint-notice'), kind: BannerKind.success, title: notice!),
          N11Card(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(children: <Widget>[Expanded(child: Text(d.code, key: const Key('m11-complaint-code'), style: N11Text.h2)), N11Chip(chip.label, kind: chip.kind)]),
                const SizedBox(height: 4),
                Text('${d.category.label} · ${d.relatedCode}', style: N11Text.caption),
                Text(d.asParty ? 'Bạn là bên liên quan' : 'Gửi lúc ${m11DateTime(d.createdAt)}', style: N11Text.caption),
              ],
            ),
          ),
          if (d.awaitingYou)
            const N11Banner(key: Key('m11-awaiting-you'), kind: BannerKind.warn, title: 'Đang chờ bạn', text: 'Hãy bổ sung thông tin hoặc giải trình để hồ sơ được xử lý tiếp.', icon: Icons.hourglass_top_rounded),
          if (d.body != null) N11Card(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[const Text('Nội dung bạn gửi', style: N11Text.label), const SizedBox(height: 4), Text(d.body!, style: N11Text.body)])),
          if (d.conclusion != null) N11InfoCard(title: 'Kết luận', text: d.conclusion),
          if (d.closeReason != null) N11InfoCard(title: 'Lý do đóng', text: d.closeReason),
          for (final ThreadLine line in d.thread)
            N11Card(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(children: <Widget>[Expanded(child: Text(_kindLabel(line), style: N11Text.label)), Text(m11DateTime(line.createdAt), style: N11Text.caption)]),
                  if (line.body != null && line.body!.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text(line.body!, style: N11Text.body)),
                  if (line.evidence.isNotEmpty) Padding(padding: const EdgeInsets.only(top: N11Space.gap2), child: EvidenceThumbs(source: source, role: role, pictures: line.evidence)),
                ],
              ),
            ),
          for (final ReconsiderationLine r in d.reconsiderations)
            N11Card(child: Text('Yêu cầu xem xét lại ${m11Date(r.requestedAt)} · ${switch (r.status) { 'PENDING' => 'đang chờ quyết định', 'REOPENED' => 'đã mở lại hồ sơ', 'REJECTED' => 'không mở lại', _ => r.status }}${r.decisionReason == null ? '' : '\n${r.decisionReason}'}', style: N11Text.body)),
          if (expired) const N11Banner(key: Key('m11-reconsider-expired'), kind: BannerKind.info, title: 'Đã hết hạn xem xét lại', text: 'Chỉ yêu cầu xem xét lại được trong 7 ngày sau khi hồ sơ đóng.'),
          if (d.canRequestReconsideration && d.reconsiderationExpiresAt != null)
            Text('Còn yêu cầu xem xét lại được đến ${m11Date(d.reconsiderationExpiresAt!)}.', key: const Key('m11-reconsider-until'), style: N11Text.caption),
        ],
            bottom: d.canSupplement || d.canRequestReconsideration
                ? Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      if (d.canSupplement)
                        N11Button(
                          key: const Key('m11-supplement'),
                          label: d.asParty ? 'Giải trình' : 'Bổ sung',
                          onPressed: () async {
                            await Navigator.of(context).push<bool>(MaterialPageRoute<bool>(builder: (_) => SupplementScreen(source: source, role: role, detail: d, picker: picker)));
                            await reload();
                          },
                        ),
                      if (d.canSupplement && d.canRequestReconsideration) const SizedBox(height: N11Space.gap2),
                      if (d.canRequestReconsideration)
                        N11Button(
                          key: const Key('m11-reconsider'),
                          label: 'Yêu cầu xem xét lại',
                          kind: d.canSupplement ? ButtonKind.secondary : ButtonKind.primary,
                          onPressed: () async {
                            final String? reason = await showReasonDialog(context, title: 'Yêu cầu xem xét lại', explanation: 'Quản trị viên sẽ quyết định có mở lại hồ sơ hay không và ghi rõ lý do. Mỗi lần đóng chỉ yêu cầu được một lần.', confirmLabel: 'Gửi yêu cầu', reasonLabel: 'Lý do', danger: false);
                            if (reason == null || !context.mounted) {
                              return;
                            }
                            await Navigator.of(context).push<bool>(MaterialPageRoute<bool>(builder: (_) => _ReconsiderSend(source: source, role: role, id: d.id, reason: reason)));
                            await reload();
                          },
                        ),
                    ],
                  )
                : null);
      },
    );
  }
}

/// Sends the reconsideration request and shows its result (kept as a screen so the operation key survives a lost answer).
class _ReconsiderSend extends StatefulWidget {
  const _ReconsiderSend({required this.source, required this.role, required this.id, required this.reason});

  final M11Source source;
  final M11Role role;
  final String id;
  final String reason;

  @override
  State<_ReconsiderSend> createState() => _ReconsiderSendState();
}

class _ReconsiderSendState extends State<_ReconsiderSend> with M07Actions<_ReconsiderSend> {
  bool _done = false;

  Future<void> _go() async {
    final bool ok = await act('reconsider', (String key) async {
      await widget.source.reconsider(widget.role, widget.id, reason: widget.reason, key: key);
    });
    if (ok && mounted) {
      setState(() => _done = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return m07Page('Xem xét lại', false, <Widget>[
      N11Card(child: Text(widget.reason, style: N11Text.body)),
      if (_done) const N11Banner(key: Key('m11-reconsider-sent'), kind: BannerKind.success, title: 'Đã gửi yêu cầu', text: 'Quản trị viên sẽ quyết định và báo kết quả cho bạn.') else actionBanner(),
      if (_done) N11Button(key: const Key('m11-reconsider-back'), label: 'Quay lại hồ sơ', onPressed: () => Navigator.of(context).pop(true)) else N11Button(key: const Key('m11-reconsider-send'), label: 'Gửi yêu cầu', loading: busy, onPressed: busy ? null : _go),
    ]);
  }
}

/// Adds text and/or pictures to a complaint (the submitter's supplement, or a related party's response).
class SupplementScreen extends StatefulWidget {
  const SupplementScreen({super.key, required this.source, required this.role, required this.detail, required this.picker});

  final M11Source source;
  final M11Role role;
  final ComplaintDetail detail;
  final ImagePickerPort picker;

  @override
  State<SupplementScreen> createState() => _SupplementScreenState();
}

class _SupplementScreenState extends State<SupplementScreen> with M07Actions<SupplementScreen>, _EvidenceUploads<SupplementScreen> {
  final TextEditingController _body = TextEditingController();

  @override
  M11Source get evidenceSource => widget.source;
  @override
  M11Role get evidenceRole => widget.role;
  @override
  ImagePickerPort get evidencePicker => widget.picker;

  @override
  void dispose() {
    _body.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final bool ok = await act('supplement', (String key) async {
      await widget.source.supplement(widget.role, widget.detail.id, body: _body.text, attachmentIds: List<String>.of(evidenceIds), key: key);
    });
    if (ok && mounted) {
      Navigator.of(context).pop(true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bool locked = busy || uploading;
    final bool ready = _body.text.trim().isNotEmpty || evidenceIds.isNotEmpty;
    final bool party = widget.detail.asParty;
    return m07Page(
      party ? 'Giải trình' : 'Bổ sung hồ sơ',
      false,
      <Widget>[
        N11Card(child: Text('${widget.detail.code} · ${widget.detail.category.label}', style: N11Text.bodyStrong)),
        M11TextBox(maxLength: 4000, optional: evidenceIds.isNotEmpty, fieldKey: const Key('m11-supplement-body'), label: party ? 'Nội dung giải trình' : 'Nội dung bổ sung', controller: _body, enabled: !locked, onChanged: () => setState(() {})),
        _EvidenceBox(count: evidenceIds.length, busy: locked, onAdd: addEvidence, onRemoveLast: removeLastEvidence, failure: evidenceFailure),
        actionBanner(),
        N11Button(
          key: const Key('m11-supplement-send'), validate: true,
          label: 'Gửi',
          loading: busy,
          onPressed: locked ? null : _send,
        ),
        if (!ready) const Text('Nhập nội dung hoặc thêm ít nhất một ảnh.', textAlign: TextAlign.center, style: N11Text.caption),
      ],
    );
  }
}

/// "Phản ánh của tôi": open / closed files filed by the person, and the files that involve them as a related party.
class ComplaintsScreen extends StatefulWidget {
  const ComplaintsScreen({super.key, required this.source, required this.role, required this.picker});

  final M11Source source;
  final M11Role role;
  final ImagePickerPort picker;

  @override
  State<ComplaintsScreen> createState() => _ComplaintsScreenState();
}

class _ComplaintsScreenState extends State<ComplaintsScreen> {
  bool _closed = false;

  @override
  Widget build(BuildContext context) {
    return m07Page('Phản ánh của tôi', false, <Widget>[
      M07Loader<ComplaintListPage>(
        key: ValueKey<bool>(_closed),
        keyPrefix: 'm11-complaints',
        load: () => widget.source.complaints(widget.role, closed: _closed),
        builder: (BuildContext context, ComplaintListPage page, Future<void> Function() reload) {
          Widget line(ComplaintLine l) {
            final ({String label, ChipKind kind}) chip = m11StatusChip(l.status);
            return InkWell(
              key: Key('m11-complaint-${l.id}'),
              borderRadius: BorderRadius.circular(kRadiusCard),
              onTap: () async {
                await Navigator.of(context).push<void>(MaterialPageRoute<void>(builder: (_) => ComplaintDetailScreen(source: widget.source, role: widget.role, complaintId: l.id, picker: widget.picker)));
                await reload();
              },
              child: N11Card(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(children: <Widget>[Expanded(child: Text(l.code, style: N11Text.bodyStrong)), N11Chip(chip.label, kind: chip.kind)]),
                    const SizedBox(height: 2),
                    Text('${l.category.label} · ${l.relatedCode} · ${m11Date(l.updatedAt)}', style: N11Text.caption),
                    if (l.summary != null && l.summary!.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text(l.summary!, maxLines: 2, overflow: TextOverflow.ellipsis, style: N11Text.body)),
                  ],
                ),
              ),
            );
          }

          return vstack(<Widget>[
            Wrap(
              spacing: N11Space.gap2,
              children: <Widget>[
                ChoiceChip(key: const Key('m11-scope-open'), label: Text('Đang mở (${page.counts.open})'), selected: !_closed, onSelected: (bool _) => setState(() => _closed = false)),
                ChoiceChip(key: const Key('m11-scope-closed'), label: Text('Đã đóng (${page.counts.closed})'), selected: _closed, onSelected: (bool _) => setState(() => _closed = true)),
              ],
            ),
            if (page.own.isEmpty)
              EmptyState(key: const Key('m11-complaints-none'), icon: Icons.inbox_outlined, title: _closed ? 'Chưa có phản ánh đã đóng' : 'Chưa có phản ánh đang mở', text: 'Phản ánh bạn gửi từ chi tiết đơn sẽ hiện ở đây.')
            else
              for (final ComplaintLine l in page.own) line(l),
            if (page.involvingMe.isNotEmpty) ...<Widget>[
              Text('Liên quan đến tôi (${page.involvingCounts.open + page.involvingCounts.closed})', key: const Key('m11-involving-title'), style: N11Text.h2),
              for (final ComplaintLine l in page.involvingMe) line(l),
            ],
          ]);
        },
      ),
    ]);
  }
}
