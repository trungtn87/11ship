/** Public, read-only SINGLE-PAGE DRAFT. Do not activate this version for registration without Owner/legal sign-off. */
export const TERMS_PAGE_PATH = 'dieu-khoan-su-dung';
export const TERMS_PAGE_VERSION = 'terms-20261112-draft-v3';
type TermsSection = { readonly id: string; readonly title: string; readonly paragraphs: readonly string[] };

const sections: readonly TermsSection[] = [
  {
    "id": "pham-vi",
    "title": "1. Phạm vi áp dụng và đơn vị vận hành",
    "paragraphs": [
      "Điều khoản này áp dụng cho việc sử dụng 11Food (khách hàng, chủ quán), 11Ship (người giao hàng) và các chức năng tài khoản liên quan. Nền tảng hỗ trợ kết nối giao dịch, điều phối thông tin đơn hàng và các công việc giao nhận trong khu vực phục vụ được công bố.",
      "Đơn vị vận hành chịu trách nhiệm đối với hoạt động nền tảng theo pháp luật; chủ quán chịu trách nhiệm đối với hàng hóa, thông tin bán hàng và nghĩa vụ của người bán; shipper chịu trách nhiệm đối với việc giao nhận mình thực hiện. Việc phân chia này không loại trừ các trách nhiệm bắt buộc theo pháp luật.",
      "Tên pháp lý, địa chỉ và kênh liên hệ chính thức của đơn vị vận hành: [CHỜ OWNER BỔ SUNG TRƯỚC KHI PHÁT HÀNH]."
    ]
  },
  {
    "id": "tai-khoan",
    "title": "2. Tài khoản, OTP và vai trò",
    "paragraphs": [
      "Người dùng cần cung cấp thông tin đúng sự thật, dùng số điện thoại thuộc quyền sử dụng hợp pháp và giữ bí mật mật khẩu, mã OTP. Một số điện thoại gắn với một tài khoản; tài khoản có thể được cấp nhiều vai trò theo các điều kiện vận hành.",
      "Đăng ký, khôi phục tài khoản hoặc một số thao tác nhạy cảm có thể yêu cầu xác minh bằng SMS OTP. Không chia sẻ OTP cho bất kỳ ai, kể cả người tự xưng là nhân viên hỗ trợ.",
      "Việc lập tài khoản không tự động cấp quyền mở quán hoặc nhận đơn giao hàng. Chủ quán và shipper chỉ được sử dụng vai trò tương ứng khi đáp ứng điều kiện và được hệ thống cấp quyền."
    ]
  },
  {
    "id": "khach-hang",
    "title": "3. Quyền và trách nhiệm của khách hàng",
    "paragraphs": [
      "Khách hàng có quyền xem thông tin cửa hàng, món ăn, giá, phí vận chuyển và các khoản thanh toán trước khi xác nhận đơn; theo dõi trạng thái đơn và gửi yêu cầu hỗ trợ khi giao dịch phát sinh sai sót.",
      "Khách hàng có trách nhiệm kiểm tra món, số lượng, địa chỉ, số điện thoại nhận hàng và thông tin thanh toán; phối hợp nhận hàng theo thời gian được thông báo. Không cố ý đặt đơn giả, yêu cầu giao hàng trái pháp luật hoặc đưa thông tin gây nhầm lẫn.",
      "Khi món ăn không đúng thông tin đã xác nhận, thiếu hàng, giao nhầm hoặc có vấn đề khác, khách hàng có quyền khiếu nại và yêu cầu phương án khắc phục theo pháp luật và chứng cứ giao dịch."
    ]
  },
  {
    "id": "chu-quan",
    "title": "4. Quyền và trách nhiệm của chủ quán",
    "paragraphs": [
      "Chủ quán phải công bố chính xác tên, địa chỉ, thông tin liên hệ, thực đơn, giá, tình trạng bán hàng, thành phần/cảnh báo cần thiết và các thông tin pháp luật yêu cầu. Chủ quán chịu trách nhiệm về nguồn gốc, chất lượng và an toàn thực phẩm của món ăn mình cung cấp.",
      "Chủ quán tiếp nhận, xác nhận, chuẩn bị và bàn giao đơn theo trạng thái được ghi nhận; thông báo kịp thời khi hết món, chậm chuẩn bị hoặc không thể phục vụ. Không quảng cáo sai, tăng giá ngoài đơn được xác nhận hoặc lợi dụng dữ liệu khách để sử dụng trái mục đích.",
      "Chủ quán được xem các giao dịch thuộc phạm vi quản lý, đối soát tiền hàng và phí có liên quan, phản hồi khiếu nại và yêu cầu xem xét quyết định hạn chế quyền quản lý."
    ]
  },
  {
    "id": "shipper",
    "title": "5. Quyền và trách nhiệm của shipper",
    "paragraphs": [
      "Shipper có quyền quyết định bật/tắt nhận đơn và tiếp nhận đơn trong phạm vi điều kiện tài khoản. Khi đã nhận đơn, shipper cần thực hiện đúng điểm lấy/giao, xác nhận trạng thái trung thực, bảo quản hàng phù hợp và tuân thủ quy định giao thông.",
      "Shipper không được tự ý thêm phí, giữ hàng, thu vượt số tiền đã được xác nhận, trao đổi thông tin cá nhân của khách/quán ngoài mục đích giao hàng hoặc giả mạo trạng thái hoàn thành.",
      "Khi không liên lạc được người nhận, xảy ra tai nạn, thất lạc, hư hại hoặc có tranh chấp thanh toán, shipper phải thông báo và phối hợp theo quy trình hỗ trợ của hệ thống; có quyền cung cấp bằng chứng và khiếu nại quyết định xử lý."
    ]
  },
  {
    "id": "don-hang",
    "title": "6. Tạo đơn và thực hiện giao hàng",
    "paragraphs": [
      "Đơn hàng hoặc yêu cầu giao trực tiếp được hình thành trên cơ sở thông tin và các bước xác nhận hiển thị trong ứng dụng. Tình trạng nhận đơn của quán, khả năng có shipper và phạm vi phục vụ có thể ảnh hưởng đến việc thực hiện đơn.",
      "Khách, chủ quán và shipper được thông báo các trạng thái liên quan đến vai trò của mình. Thời hạn xử lý và trường hợp đơn hết hiệu lực hoặc bị hủy theo các mốc thời gian được hiển thị trong ứng dụng tại thời điểm giao dịch.",
      "Các bên có trách nhiệm kiểm tra thông tin trước khi xác nhận; bằng chứng trạng thái, thời gian và trao đổi về đơn được dùng để phục vụ đối soát và xử lý tranh chấp theo pháp luật."
    ]
  },
  {
    "id": "gia-phi",
    "title": "7. Giá bán, phí giao hàng và tiền tip",
    "paragraphs": [
      "Giá món ăn do chủ quán công bố. Phí giao hàng được tính theo chính sách đang áp dụng và hiển thị trước khi người dùng xác nhận nghĩa vụ thanh toán; trường hợp chưa có báo giá phải thể hiện rõ trạng thái chưa xác định, không được hiểu là miễn phí.",
      "Tiền tip là khoản tự nguyện nếu tính năng được cung cấp. Mọi khoản điều chỉnh giá, phí hoặc nội dung đơn sau khi xác nhận cần có căn cứ và sự chấp thuận phù hợp của bên có nghĩa vụ trả tiền.",
      "Biểu phí, hoa hồng hoặc khoản khấu trừ áp dụng cho chủ quán/shipper phải được công bố ở giao diện phù hợp và ghi nhận theo từng giao dịch; điều khoản này không tự đặt ra mức phí cố định."
    ]
  },
  {
    "id": "vi-thu-ho",
    "title": "8. Ví shipper, nạp/rút tiền và tiền thu hộ",
    "paragraphs": [
      "Ví shipper là công cụ ghi nhận số dư hoạt động, giao dịch và các khoản phí/hoa hồng theo quy tắc đã công bố. Điều kiện để bật nhận đơn, mức nạp và khoản giữ tạm nếu có được thể hiện trong màn hình ví hoặc điều kiện nhận đơn.",
      "Với quy trình nạp/rút bằng chuyển khoản thủ công, giao dịch chỉ được xác nhận sau khi có đối chiếu hợp lệ. Số dư, lịch sử và bút toán điều chỉnh phải có căn cứ; thời gian xử lý và hạn mức theo thông tin công bố tại thời điểm yêu cầu.",
      "Tiền thu hộ từ khách cho quán/bên gửi hàng là nghĩa vụ đối soát riêng, không mặc nhiên là tài sản hay số dư khả dụng của shipper. Sai lệch, hoàn trả, thiếu hụt hoặc mất mát phải được xác minh với chứng cứ và giải quyết theo trách nhiệm thực tế."
    ]
  },
  {
    "id": "huy-hoan",
    "title": "9. Hủy đơn, hoàn tiền và bồi thường",
    "paragraphs": [
      "Quyền hủy đơn phụ thuộc vào trạng thái thực hiện, việc quán đã chuẩn bị hàng, shipper đã nhận việc, nguyên nhân hủy và pháp luật áp dụng. Chi phí hợp lệ có thể phát sinh phải được công khai trước khi người dùng xác nhận hủy, khi việc công khai đó là cần thiết.",
      "Với đơn sai, thiếu, không giao được, thất lạc hoặc hư hại, nền tảng tiếp nhận phản ánh và phối hợp các bên xác minh. Hoàn tiền, giao bù hoặc bồi thường được xác định theo trách nhiệm, chứng cứ, thỏa thuận hợp pháp và quy định bảo vệ người tiêu dùng.",
      "Không điều khoản nào được hiểu là miễn trừ trách nhiệm bắt buộc hoặc hạn chế các quyền khiếu nại, yêu cầu bồi thường được pháp luật bảo vệ."
    ]
  },
  {
    "id": "vi-tri",
    "title": "10. Vị trí, theo dõi đơn và trao đổi",
    "paragraphs": [
      "Ứng dụng có thể sử dụng vị trí khi người dùng chủ động cấp quyền để tìm địa điểm, ghim địa chỉ, ghép đơn, định tuyến hoặc thực hiện giao nhận. Việc thu thập và chia sẻ vị trí cần phù hợp mục đích, trạng thái hoạt động và Chính sách quyền riêng tư.",
      "Liên kết theo dõi đơn nếu được tạo có thể cho người sở hữu liên kết xem thông tin tiến trình và phần vị trí được chia sẻ theo lựa chọn/thiết lập của hệ thống. Người dùng cần bảo vệ liên kết và hạn chế chia sẻ với người không liên quan.",
      "Tin nhắn, ảnh, nhận xét và thông báo về đơn chỉ được sử dụng cho mục đích giao dịch và hỗ trợ; nghiêm cấm quấy rối, lừa đảo, đăng nội dung trái pháp luật hoặc tiết lộ dữ liệu của người khác."
    ]
  },
  {
    "id": "danh-gia",
    "title": "11. Đánh giá, phản ánh và khiếu nại",
    "paragraphs": [
      "Người dùng có thể đánh giá hoặc phản ánh chất lượng dịch vụ theo điều kiện của từng giao dịch. Đánh giá cần dựa trên trải nghiệm thực tế; hệ thống có quyền xử lý nội dung giả mạo, xúc phạm hoặc vi phạm pháp luật.",
      "Các bên có quyền gửi khiếu nại qua tính năng hỗ trợ hoặc kênh liên hệ chính thức, cung cấp bằng chứng và đề nghị xem xét lại kết quả xử lý. Thời hạn tiếp nhận, phản hồi và quy trình giải quyết sẽ được công bố riêng theo nghĩa vụ pháp luật."
    ]
  },
  {
    "id": "vi-pham",
    "title": "12. Hành vi bị cấm và biện pháp xử lý",
    "paragraphs": [
      "Cấm gian lận đơn hàng, giả mạo danh tính, tạo nhiều tài khoản nhằm trục lợi, thao túng đánh giá, sử dụng ứng dụng để kinh doanh hàng cấm, tấn công hệ thống, khai thác dữ liệu trái phép hoặc xâm phạm quyền lợi bên khác.",
      "Khi có căn cứ vi phạm hoặc rủi ro bảo mật, hệ thống có thể cảnh báo, tạm hạn chế tính năng, khóa quyền vai trò hoặc tài khoản ở mức độ phù hợp. Người bị xử lý có quyền biết lý do trong phạm vi pháp luật cho phép và gửi yêu cầu xem xét.",
      "Việc xử lý tài khoản không xóa nghĩa vụ đối soát, hoàn trả tiền, giao hàng hoặc cung cấp thông tin theo yêu cầu hợp pháp của cơ quan có thẩm quyền."
    ]
  },
  {
    "id": "du-lieu",
    "title": "13. Dữ liệu cá nhân và bảo mật",
    "paragraphs": [
      "Việc thu thập và xử lý số điện thoại, thông tin hồ sơ, địa chỉ, vị trí, lịch sử đơn, thông tin ví, tài khoản ngân hàng và dữ liệu cần thiết khác được giải thích trong Chính sách quyền riêng tư công bố riêng.",
      "Nền tảng phải áp dụng các biện pháp bảo vệ phù hợp, thông báo các nội dung bắt buộc và thực hiện quyền của chủ thể dữ liệu theo pháp luật Việt Nam. Những mục đích xử lý cần sự đồng ý riêng không mặc nhiên được chấp thuận chỉ bằng cách đồng ý Điều khoản sử dụng.",
      "Người dùng không được sử dụng dữ liệu cá nhân thấy trong đơn hàng để quảng cáo, quấy rối hoặc thực hiện hoạt động ngoài phạm vi giao dịch được phép."
    ]
  },
  {
    "id": "xoa-tai-khoan",
    "title": "14. Khóa, khôi phục và yêu cầu xóa tài khoản",
    "paragraphs": [
      "Người dùng có thể gửi yêu cầu xóa tài khoản theo quy trình chính thức của hệ thống. Việc khóa đăng nhập, hủy quyền sử dụng vai trò và xóa dữ liệu được thực hiện phù hợp tình trạng giao dịch, nghĩa vụ còn tồn tại và quy định pháp luật.",
      "Hồ sơ đơn hàng, đối soát, hóa đơn/chứng từ và thông tin phục vụ tranh chấp có thể cần được lưu theo thời hạn pháp luật yêu cầu; các dữ liệu không còn căn cứ xử lý phải được xử lý theo quyền của người dùng và pháp luật áp dụng.",
      "Tài khoản đang còn đơn hoặc tiền chưa đối soát được giải quyết theo quy trình công bố; yêu cầu xóa không làm mất quyền nhận tiền hoặc nghĩa vụ thanh toán của các bên."
    ]
  },
  {
    "id": "cap-nhat",
    "title": "15. Cập nhật và hiệu lực điều khoản",
    "paragraphs": [
      "Mỗi phiên bản có mã phiên bản và ngày hiệu lực riêng. Khi thay đổi nội dung quan trọng, nền tảng sẽ công khai văn bản mới, thông báo phù hợp và xin lại sự đồng ý nếu pháp luật hoặc tính chất thay đổi yêu cầu.",
      "Việc đồng ý được ghi nhận theo phiên bản và thời điểm trên hệ thống; giao dịch đã phát sinh được xử lý theo điều kiện áp dụng tại thời điểm giao dịch và các quy định pháp luật bắt buộc.",
      "Bản đang hiển thị là DỰ THẢO, chưa thay thế điều khoản mà các tài khoản đã đồng ý trước đó."
    ]
  },
  {
    "id": "tranh-chap",
    "title": "16. Giải quyết tranh chấp và liên hệ",
    "paragraphs": [
      "Khi có tranh chấp, các bên ưu tiên cung cấp thông tin và đối thoại qua kênh hỗ trợ chính thức; trường hợp không giải quyết được có quyền sử dụng các phương thức theo pháp luật Việt Nam và yêu cầu cơ quan có thẩm quyền xử lý.",
      "Kênh nhận khiếu nại, địa chỉ liên hệ, thời gian hỗ trợ: [CHỜ OWNER CÔNG BỐ TRƯỚC KHI PHÁT HÀNH]. Quyền của người tiêu dùng theo pháp luật không bị giới hạn bởi điều khoản này."
    ]
  }
];

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const nav = sections.map(({ id, title }) => `<a href="#${escapeHtml(id)}">${escapeHtml(title)}</a>`).join('');
const body = sections.map(({ id, title, paragraphs }) =>
  `<section id="${escapeHtml(id)}"><h2>${escapeHtml(title)}</h2>${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}</section>`
).join('');

export const TERMS_PAGE_HTML = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="color-scheme" content="light">
<title>Điều khoản sử dụng — 11Food &amp; 11Ship (Dự thảo)</title>
<style>
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2927;background:#f4f8f5;font-size:16px}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0}header{background:#fff;border-bottom:1px solid #dce6df}
.wrap{max-width:1040px;margin:0 auto;padding:22px 20px}header .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px}
.brand{font-weight:800;color:#166b53;font-size:1.18rem;letter-spacing:-.03em}.version{font-size:.76rem;color:#586860}
main{max-width:1040px;margin:0 auto;padding:32px 20px 70px}.intro{padding:22px 24px;background:white;border:1px solid #dce6df;border-radius:16px;margin-bottom:24px}
h1{font-size:clamp(1.55rem,4vw,2.35rem);letter-spacing:-.04em;margin:0 0 10px}h2{font-size:1.13rem;letter-spacing:-.015em;margin:0 0 14px}p{line-height:1.72;margin:0 0 13px}
.notice{padding:12px 15px;background:#fff2df;border-left:4px solid #bc730c;border-radius:6px;margin:14px 0;color:#633f08;font-weight:600}
.meta{font-size:.87rem;color:#586860}.layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:24px;align-items:start}
nav{position:sticky;top:16px;max-height:calc(100vh - 32px);overflow:auto;border:1px solid #dce6df;border-radius:14px;background:white;padding:15px}
nav strong{display:block;font-size:.85rem;margin-bottom:10px}nav a{display:block;font-size:.81rem;line-height:1.5;padding:7px 4px;color:#1b6751;text-decoration:none}
nav a:hover,nav a:focus-visible{text-decoration:underline}
article{background:white;border:1px solid #dce6df;border-radius:16px;padding:28px 32px}
section{scroll-margin-top:18px;padding:0 0 15px;margin-bottom:22px;border-bottom:1px solid #e4eee7}
section:last-child{border:0;padding:0;margin:0}section p:last-child{margin:0}
footer{text-align:center;font-size:.85rem;color:#66766b;margin-top:30px}
@media(max-width:720px){.layout{display:block}nav{position:static;max-height:190px;margin-bottom:18px}article{padding:22px 18px}.intro{padding:20px 18px}header .wrap{padding:16px 20px}}
</style>
</head>
<body>
<header><div class="wrap"><span class="brand">11Food <span aria-hidden="true">·</span> 11Ship</span><span class="version">Phiên bản: ${TERMS_PAGE_VERSION}</span></div></header>
<main>
<div class="intro">
<h1>Điều khoản sử dụng</h1>
<p>Áp dụng cho khách hàng, chủ quán và người giao hàng trong hệ sinh thái 11Food &amp; 11Ship.</p>
<div class="notice" role="status">BẢN DỰ THẢO — CHƯA CÓ HIỆU LỰC. Không phải văn bản đang được xác nhận khi đăng ký.</div>
<p class="meta">Ngày dự thảo: 12/11/2026 · Phiên bản: ${TERMS_PAGE_VERSION} · Chỉ xuất bản chính thức sau khi bổ sung thông tin đơn vị vận hành và hoàn tất rà soát pháp lý.</p>
<p class="meta"><a href="/chinh-sach-quyen-rieng-tu">Xem Chính sách quyền riêng tư</a></p>
</div>
<div class="layout"><nav aria-label="Mục lục điều khoản"><strong>Nội dung</strong>${nav}</nav><article>${body}</article></div>
<footer>11Food &amp; 11Ship · Điều khoản sử dụng</footer>
</main>
</body></html>`;
