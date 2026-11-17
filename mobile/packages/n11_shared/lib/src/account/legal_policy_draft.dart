// Owner-approved legal text, frozen on 2026-11-14.
// Mirrored verbatim from apps/backend/src/legal/{terms-page,privacy-page}.ts.
// Historical filename kept to avoid changing imports across both applications.
class LegalPolicySection {
  const LegalPolicySection({required this.title, required this.paragraphs});

  final String title;
  final List<String> paragraphs;
}

const String kTermsPolicyVersion = 'terms-20261114-v3';
const String kPrivacyPolicyVersion = 'privacy-20261114-v3';
const List<LegalPolicySection> kTermsPolicySections = <LegalPolicySection>[
  LegalPolicySection(
    title: "1. Phạm vi áp dụng và đơn vị vận hành",
    paragraphs: <String>[
      "Điều khoản này áp dụng cho việc sử dụng 11Food (khách hàng, chủ quán), 11Ship (người giao hàng) và các chức năng tài khoản liên quan. Nền tảng hỗ trợ kết nối giao dịch, điều phối thông tin đơn hàng và các công việc giao nhận trong khu vực phục vụ được công bố.",
      "Đơn vị vận hành chịu trách nhiệm đối với hoạt động nền tảng theo pháp luật; chủ quán chịu trách nhiệm đối với hàng hóa, thông tin bán hàng và nghĩa vụ của người bán; shipper chịu trách nhiệm đối với việc giao nhận mình thực hiện. Việc phân chia này không loại trừ các trách nhiệm bắt buộc theo pháp luật.",
      "Tên pháp lý, địa chỉ và kênh liên hệ chính thức của đơn vị vận hành: thông tin về chủ thể vận hành và kênh tiếp nhận được cung cấp tại mục Trợ giúp của 11Food/11Ship; người dùng có thể yêu cầu làm rõ các thông tin này trước khi giao dịch.",
    ],
  ),
  LegalPolicySection(
    title: "2. Tài khoản, OTP và vai trò",
    paragraphs: <String>[
      "Người dùng cần cung cấp thông tin đúng sự thật, dùng số điện thoại thuộc quyền sử dụng hợp pháp và giữ bí mật mật khẩu, mã OTP. Một số điện thoại gắn với một tài khoản; tài khoản có thể được cấp nhiều vai trò theo các điều kiện vận hành.",
      "Đăng ký, khôi phục tài khoản hoặc một số thao tác nhạy cảm có thể yêu cầu xác minh bằng SMS OTP. Không chia sẻ OTP cho bất kỳ ai, kể cả người tự xưng là nhân viên hỗ trợ.",
      "Việc lập tài khoản không tự động cấp quyền mở quán hoặc nhận đơn giao hàng. Chủ quán và shipper chỉ được sử dụng vai trò tương ứng khi đáp ứng điều kiện và được hệ thống cấp quyền.",
    ],
  ),
  LegalPolicySection(
    title: "3. Quyền và trách nhiệm của khách hàng",
    paragraphs: <String>[
      "Khách hàng có quyền xem thông tin cửa hàng, món ăn, giá, phí vận chuyển và các khoản thanh toán trước khi xác nhận đơn; theo dõi trạng thái đơn và gửi yêu cầu hỗ trợ khi giao dịch phát sinh sai sót.",
      "Khách hàng có trách nhiệm kiểm tra món, số lượng, địa chỉ, số điện thoại nhận hàng và thông tin thanh toán; phối hợp nhận hàng theo thời gian được thông báo. Không cố ý đặt đơn giả, yêu cầu giao hàng trái pháp luật hoặc đưa thông tin gây nhầm lẫn.",
      "Khi món ăn không đúng thông tin đã xác nhận, thiếu hàng, giao nhầm hoặc có vấn đề khác, khách hàng có quyền khiếu nại và yêu cầu phương án khắc phục theo pháp luật và chứng cứ giao dịch.",
    ],
  ),
  LegalPolicySection(
    title: "4. Quyền và trách nhiệm của chủ quán",
    paragraphs: <String>[
      "Chủ quán phải công bố chính xác tên, địa chỉ, thông tin liên hệ, thực đơn, giá, tình trạng bán hàng, thành phần/cảnh báo cần thiết và các thông tin pháp luật yêu cầu. Chủ quán chịu trách nhiệm về nguồn gốc, chất lượng và an toàn thực phẩm của món ăn mình cung cấp.",
      "Chủ quán tiếp nhận, xác nhận, chuẩn bị và bàn giao đơn theo trạng thái được ghi nhận; thông báo kịp thời khi hết món, chậm chuẩn bị hoặc không thể phục vụ. Không quảng cáo sai, tăng giá ngoài đơn được xác nhận hoặc lợi dụng dữ liệu khách để sử dụng trái mục đích.",
      "Chủ quán được xem các giao dịch thuộc phạm vi quản lý, đối soát tiền hàng và phí có liên quan, phản hồi khiếu nại và yêu cầu xem xét quyết định hạn chế quyền quản lý.",
    ],
  ),
  LegalPolicySection(
    title: "5. Quyền và trách nhiệm của shipper",
    paragraphs: <String>[
      "Shipper có quyền quyết định bật/tắt nhận đơn và tiếp nhận đơn trong phạm vi điều kiện tài khoản. Khi đã nhận đơn, shipper cần thực hiện đúng điểm lấy/giao, xác nhận trạng thái trung thực, bảo quản hàng phù hợp và tuân thủ quy định giao thông.",
      "Shipper không được tự ý thêm phí, giữ hàng, thu vượt số tiền đã được xác nhận, trao đổi thông tin cá nhân của khách/quán ngoài mục đích giao hàng hoặc giả mạo trạng thái hoàn thành.",
      "Khi không liên lạc được người nhận, xảy ra tai nạn, thất lạc, hư hại hoặc có tranh chấp thanh toán, shipper phải thông báo và phối hợp theo quy trình hỗ trợ của hệ thống; có quyền cung cấp bằng chứng và khiếu nại quyết định xử lý.",
    ],
  ),
  LegalPolicySection(
    title: "6. Tạo đơn và thực hiện giao hàng",
    paragraphs: <String>[
      "Đơn hàng hoặc yêu cầu giao trực tiếp được hình thành trên cơ sở thông tin và các bước xác nhận hiển thị trong ứng dụng. Tình trạng nhận đơn của quán, khả năng có shipper và phạm vi phục vụ có thể ảnh hưởng đến việc thực hiện đơn.",
      "Khách, chủ quán và shipper được thông báo các trạng thái liên quan đến vai trò của mình. Thời hạn xử lý và trường hợp đơn hết hiệu lực hoặc bị hủy theo các mốc thời gian được hiển thị trong ứng dụng tại thời điểm giao dịch.",
      "Các bên có trách nhiệm kiểm tra thông tin trước khi xác nhận; bằng chứng trạng thái, thời gian và trao đổi về đơn được dùng để phục vụ đối soát và xử lý tranh chấp theo pháp luật.",
    ],
  ),
  LegalPolicySection(
    title: "7. Giá bán, phí giao hàng và tiền tip",
    paragraphs: <String>[
      "Giá món ăn do chủ quán công bố. Phí giao hàng được tính theo chính sách đang áp dụng và hiển thị trước khi người dùng xác nhận nghĩa vụ thanh toán; trường hợp chưa có báo giá phải thể hiện rõ trạng thái chưa xác định, không được hiểu là miễn phí.",
      "Tiền tip là khoản tự nguyện nếu tính năng được cung cấp. Mọi khoản điều chỉnh giá, phí hoặc nội dung đơn sau khi xác nhận cần có căn cứ và sự chấp thuận phù hợp của bên có nghĩa vụ trả tiền.",
      "Biểu phí, hoa hồng hoặc khoản khấu trừ áp dụng cho chủ quán/shipper phải được công bố ở giao diện phù hợp và ghi nhận theo từng giao dịch; điều khoản này không tự đặt ra mức phí cố định.",
    ],
  ),
  LegalPolicySection(
    title: "8. Ví shipper, nạp/rút tiền và tiền thu hộ",
    paragraphs: <String>[
      "Ví shipper là công cụ ghi nhận số dư hoạt động, giao dịch và các khoản phí/hoa hồng theo quy tắc đã công bố. Điều kiện để bật nhận đơn, mức nạp và khoản giữ tạm nếu có được thể hiện trong màn hình ví hoặc điều kiện nhận đơn.",
      "Với quy trình nạp/rút bằng chuyển khoản thủ công, giao dịch chỉ được xác nhận sau khi có đối chiếu hợp lệ. Số dư, lịch sử và bút toán điều chỉnh phải có căn cứ; thời gian xử lý và hạn mức theo thông tin công bố tại thời điểm yêu cầu.",
      "Tiền thu hộ từ khách cho quán/bên gửi hàng là nghĩa vụ đối soát riêng, không mặc nhiên là tài sản hay số dư khả dụng của shipper. Sai lệch, hoàn trả, thiếu hụt hoặc mất mát phải được xác minh với chứng cứ và giải quyết theo trách nhiệm thực tế.",
    ],
  ),
  LegalPolicySection(
    title: "9. Hủy đơn, hoàn tiền và bồi thường",
    paragraphs: <String>[
      "Quyền hủy đơn phụ thuộc vào trạng thái thực hiện, việc quán đã chuẩn bị hàng, shipper đã nhận việc, nguyên nhân hủy và pháp luật áp dụng. Chi phí hợp lệ có thể phát sinh phải được công khai trước khi người dùng xác nhận hủy, khi việc công khai đó là cần thiết.",
      "Với đơn sai, thiếu, không giao được, thất lạc hoặc hư hại, nền tảng tiếp nhận phản ánh và phối hợp các bên xác minh. Hoàn tiền, giao bù hoặc bồi thường được xác định theo trách nhiệm, chứng cứ, thỏa thuận hợp pháp và quy định bảo vệ người tiêu dùng.",
      "Không điều khoản nào được hiểu là miễn trừ trách nhiệm bắt buộc hoặc hạn chế các quyền khiếu nại, yêu cầu bồi thường được pháp luật bảo vệ.",
    ],
  ),
  LegalPolicySection(
    title: "10. Vị trí, theo dõi đơn và trao đổi",
    paragraphs: <String>[
      "Ứng dụng có thể sử dụng vị trí khi người dùng chủ động cấp quyền để tìm địa điểm, ghim địa chỉ, ghép đơn, định tuyến hoặc thực hiện giao nhận. Việc thu thập và chia sẻ vị trí cần phù hợp mục đích, trạng thái hoạt động và Chính sách quyền riêng tư.",
      "Liên kết theo dõi đơn nếu được tạo có thể cho người sở hữu liên kết xem thông tin tiến trình và phần vị trí được chia sẻ theo lựa chọn/thiết lập của hệ thống. Người dùng cần bảo vệ liên kết và hạn chế chia sẻ với người không liên quan.",
      "Tin nhắn, ảnh, nhận xét và thông báo về đơn chỉ được sử dụng cho mục đích giao dịch và hỗ trợ; nghiêm cấm quấy rối, lừa đảo, đăng nội dung trái pháp luật hoặc tiết lộ dữ liệu của người khác.",
    ],
  ),
  LegalPolicySection(
    title: "11. Đánh giá, phản ánh và khiếu nại",
    paragraphs: <String>[
      "Người dùng có thể đánh giá hoặc phản ánh chất lượng dịch vụ theo điều kiện của từng giao dịch. Đánh giá cần dựa trên trải nghiệm thực tế; hệ thống có quyền xử lý nội dung giả mạo, xúc phạm hoặc vi phạm pháp luật.",
      "Các bên có quyền gửi khiếu nại qua tính năng hỗ trợ hoặc kênh liên hệ chính thức, cung cấp bằng chứng và đề nghị xem xét lại kết quả xử lý. Thời hạn tiếp nhận, phản hồi và quy trình giải quyết sẽ được công bố riêng theo nghĩa vụ pháp luật.",
    ],
  ),
  LegalPolicySection(
    title: "12. Hành vi bị cấm và biện pháp xử lý",
    paragraphs: <String>[
      "Cấm gian lận đơn hàng, giả mạo danh tính, tạo nhiều tài khoản nhằm trục lợi, thao túng đánh giá, sử dụng ứng dụng để kinh doanh hàng cấm, tấn công hệ thống, khai thác dữ liệu trái phép hoặc xâm phạm quyền lợi bên khác.",
      "Khi có căn cứ vi phạm hoặc rủi ro bảo mật, hệ thống có thể cảnh báo, tạm hạn chế tính năng, khóa quyền vai trò hoặc tài khoản ở mức độ phù hợp. Người bị xử lý có quyền biết lý do trong phạm vi pháp luật cho phép và gửi yêu cầu xem xét.",
      "Việc xử lý tài khoản không xóa nghĩa vụ đối soát, hoàn trả tiền, giao hàng hoặc cung cấp thông tin theo yêu cầu hợp pháp của cơ quan có thẩm quyền.",
    ],
  ),
  LegalPolicySection(
    title: "13. Dữ liệu cá nhân và bảo mật",
    paragraphs: <String>[
      "Việc thu thập và xử lý số điện thoại, thông tin hồ sơ, địa chỉ, vị trí, lịch sử đơn, thông tin ví, tài khoản ngân hàng và dữ liệu cần thiết khác được giải thích trong Chính sách quyền riêng tư công bố riêng.",
      "Nền tảng phải áp dụng các biện pháp bảo vệ phù hợp, thông báo các nội dung bắt buộc và thực hiện quyền của chủ thể dữ liệu theo pháp luật Việt Nam. Những mục đích xử lý cần sự đồng ý riêng không mặc nhiên được chấp thuận chỉ bằng cách đồng ý Điều khoản sử dụng.",
      "Người dùng không được sử dụng dữ liệu cá nhân thấy trong đơn hàng để quảng cáo, quấy rối hoặc thực hiện hoạt động ngoài phạm vi giao dịch được phép.",
    ],
  ),
  LegalPolicySection(
    title: "14. Khóa, khôi phục và yêu cầu xóa tài khoản",
    paragraphs: <String>[
      "Người dùng có thể gửi yêu cầu xóa tài khoản theo quy trình chính thức của hệ thống. Việc khóa đăng nhập, hủy quyền sử dụng vai trò và xóa dữ liệu được thực hiện phù hợp tình trạng giao dịch, nghĩa vụ còn tồn tại và quy định pháp luật.",
      "Hồ sơ đơn hàng, đối soát, hóa đơn/chứng từ và thông tin phục vụ tranh chấp có thể cần được lưu theo thời hạn pháp luật yêu cầu; các dữ liệu không còn căn cứ xử lý phải được xử lý theo quyền của người dùng và pháp luật áp dụng.",
      "Tài khoản đang còn đơn hoặc tiền chưa đối soát được giải quyết theo quy trình công bố; yêu cầu xóa không làm mất quyền nhận tiền hoặc nghĩa vụ thanh toán của các bên.",
    ],
  ),
  LegalPolicySection(
    title: "15. Cập nhật và hiệu lực điều khoản",
    paragraphs: <String>[
      "Mỗi phiên bản có mã phiên bản và ngày hiệu lực riêng. Khi thay đổi nội dung quan trọng, nền tảng sẽ công khai văn bản mới, thông báo phù hợp và xin lại sự đồng ý nếu pháp luật hoặc tính chất thay đổi yêu cầu.",
      "Việc đồng ý được ghi nhận theo phiên bản và thời điểm trên hệ thống; giao dịch đã phát sinh được xử lý theo điều kiện áp dụng tại thời điểm giao dịch và các quy định pháp luật bắt buộc.",
      "Bản đang hiển thị có hiệu lực đối với người dùng chấp thuận phiên bản này; các phiên bản đã đồng ý trước đó được lưu để đối chiếu lịch sử.",
    ],
  ),
  LegalPolicySection(
    title: "16. Giải quyết tranh chấp và liên hệ",
    paragraphs: <String>[
      "Khi có tranh chấp, các bên ưu tiên cung cấp thông tin và đối thoại qua kênh hỗ trợ chính thức; trường hợp không giải quyết được có quyền sử dụng các phương thức theo pháp luật Việt Nam và yêu cầu cơ quan có thẩm quyền xử lý.",
      "Kênh nhận khiếu nại, địa chỉ liên hệ, thời gian hỗ trợ: liên hệ qua mục Trợ giúp trong ứng dụng 11Food/11Ship để yêu cầu thông tin về kênh tiếp nhận, phương thức và tiến độ giải quyết. Quyền của người tiêu dùng theo pháp luật không bị giới hạn bởi điều khoản này.",
    ],
  ),
];
const List<LegalPolicySection> kPrivacyPolicySections = <LegalPolicySection>[
  LegalPolicySection(
    title: "1. Đơn vị xử lý và phạm vi",
    paragraphs: <String>[
      "Chính sách này giải thích việc thu thập, sử dụng, chia sẻ, lưu giữ và bảo vệ dữ liệu cá nhân khi khách hàng, chủ quán và người giao hàng sử dụng 11Food, 11Ship hoặc chức năng quản lý liên quan.",
      "Đơn vị chịu trách nhiệm về dữ liệu cá nhân: thông tin về chủ thể vận hành, địa chỉ và đầu mối tiếp nhận yêu cầu dữ liệu cá nhân được cung cấp khi liên hệ qua mục Trợ giúp của 11Food/11Ship. Vai trò bên kiểm soát/bên xử lý dữ liệu và các đơn vị liên quan phải được xác định trước khi công bố chính thức.",
    ],
  ),
  LegalPolicySection(
    title: "2. Những dữ liệu có thể được xử lý",
    paragraphs: <String>[
      "Tài khoản: họ tên, số điện thoại, mật khẩu lưu dưới dạng băm, thông tin xác minh OTP, vai trò, trạng thái tài khoản, dữ liệu phiên đăng nhập và thiết bị cần thiết để bảo mật.",
      "Khách hàng/đơn hàng: tên và số liên lạc của người nhận, địa chỉ, điểm ghim trên bản đồ, món đã chọn, ghi chú, phí, trạng thái, thời điểm, phương thức thanh toán và lịch sử giao nhận.",
      "Chủ quán: thông tin liên hệ, địa chỉ và vị trí quán, thực đơn, hình ảnh, giờ nhận đơn, hồ sơ xét duyệt và dữ liệu phục vụ quản trị đơn.",
      "Shipper: hồ sơ cá nhân, biển số xe, trạng thái nhận đơn, địa điểm lấy/giao, vị trí phục vụ ghép đơn và theo dõi giao hàng, thông tin tài khoản ngân hàng khi cần đối soát và thanh toán.",
      "Ví và hỗ trợ: số dư, yêu cầu nạp/rút, khoản thu hộ, lịch sử đối soát, tin nhắn trong đơn, đánh giá, hình ảnh/đính kèm khiếu nại, thông báo và lịch sử đồng ý theo phiên bản.",
      "An ninh hệ thống: nhật ký thao tác, sự kiện đăng nhập, mã nhận dạng thiết bị và thông tin kỹ thuật cần thiết để phát hiện truy cập trái phép, chống gian lận, kiểm toán và khắc phục sự cố.",
    ],
  ),
  LegalPolicySection(
    title: "3. Mục đích và căn cứ xử lý",
    paragraphs: <String>[
      "Dữ liệu được xử lý để tạo và bảo vệ tài khoản; xác minh chủ quán/shipper; hiển thị địa điểm, tìm đường, báo giá, thực hiện đơn; liên lạc giữa các bên; đối soát ví, tiền hàng, tiền thu hộ; tiếp nhận khiếu nại; gửi thông báo cần thiết; phòng chống gian lận và đáp ứng nghĩa vụ pháp luật.",
      "Tùy hoạt động, căn cứ xử lý có thể là sự đồng ý hợp lệ, việc thực hiện yêu cầu/giao dịch của người dùng, nghĩa vụ pháp luật hoặc căn cứ khác được pháp luật cho phép. Căn cứ tương ứng với từng hoạt động cần được xác định và thực hiện theo quy định pháp luật trước khi xử lý dữ liệu.",
      "Những mục đích không cần thiết để cung cấp dịch vụ như tiếp thị, cá nhân hóa tùy chọn hoặc chia sẻ cho quảng cáo phải được thông báo và, khi pháp luật yêu cầu, có lựa chọn đồng ý riêng. Không xem việc tích Điều khoản sử dụng là sự đồng ý cho mọi mục đích xử lý dữ liệu.",
    ],
  ),
  LegalPolicySection(
    title: "4. Dữ liệu vị trí và tính riêng tư khi giao hàng",
    paragraphs: <String>[
      "Khách hàng có thể cấp quyền hoặc tự chọn điểm giao trên bản đồ. Chủ quán có thể ghim vị trí quán. Shipper có thể cấp quyền vị trí khi bật nhận đơn hoặc đang thực hiện giao hàng để nền tảng ghép đơn, tính quãng đường, chỉ đường và cập nhật tiến trình.",
      "Vị trí được xác định qua dịch vụ định vị là dữ liệu cá nhân nhạy cảm; việc xử lý phải có biện pháp bảo vệ và cơ chế thông báo, đồng ý hoặc căn cứ pháp lý phù hợp. Quyền vị trí của hệ điều hành không thay thế mọi nghĩa vụ đồng ý theo pháp luật.",
      "Khi sử dụng liên kết theo dõi đơn, người có liên kết có thể nhìn thấy tiến độ và thông tin vị trí được phép chia sẻ trong phạm vi đơn đó; người tạo liên kết cần cân nhắc trước khi gửi cho người khác. Phạm vi, thời điểm cập nhật và cơ chế thu hồi phải phù hợp chức năng đang triển khai.",
    ],
  ),
  LegalPolicySection(
    title: "5. Chia sẻ dữ liệu và nhà cung cấp dịch vụ",
    paragraphs: <String>[
      "Trong một đơn hàng, quán, khách và shipper chỉ được tiếp cận những thông tin cần thiết để xác nhận, chuẩn bị, giao, nhận và xử lý sự cố của đơn. Thông tin tài khoản ngân hàng của shipper không được công khai cho khách hàng hoặc quán.",
      "Nhân sự có thẩm quyền của đơn vị vận hành được tiếp cận dữ liệu theo phạm vi nhiệm vụ. Bên cung cấp SMS OTP, bản đồ, thông báo đẩy, máy chủ/lưu trữ, dịch vụ hỗ trợ hoặc các nhà cung cấp kỹ thuật khác có thể xử lý dữ liệu theo hợp đồng và yêu cầu bảo mật tương ứng.",
      "Nếu có chuyển dữ liệu cá nhân ra nước ngoài, việc này phải được rà soát và thực hiện đúng điều kiện pháp luật. danh mục bên xử lý, vị trí lưu trữ và luồng dữ liệu được đơn vị vận hành cung cấp cho người dùng khi có yêu cầu qua kênh Trợ giúp.",
      "Nền tảng chỉ cung cấp dữ liệu cho cơ quan có thẩm quyền theo yêu cầu hợp pháp. Không sử dụng thông tin nhận từ đơn hàng để bán, phát tán hoặc phục vụ mục đích trái pháp luật.",
    ],
  ),
  LegalPolicySection(
    title: "6. Biện pháp bảo vệ và xử lý sự cố",
    paragraphs: <String>[
      "Áp dụng các biện pháp kỹ thuật và tổ chức phù hợp như giới hạn quyền truy cập, bảo vệ phiên đăng nhập, băm mật khẩu, kiểm soát thao tác tài chính và lưu vết hoạt động quản trị. Biện pháp bảo mật thực tế sẽ được kiểm thử và rà soát theo mức độ rủi ro.",
      "Không có hệ thống nào tuyệt đối không có rủi ro. Khi phát hiện sự cố ảnh hưởng dữ liệu cá nhân, đơn vị vận hành sẽ đánh giá, khắc phục và thông báo cho cá nhân/cơ quan có thẩm quyền theo thời hạn và nội dung pháp luật áp dụng, đặc biệt với dữ liệu vị trí.",
      "Người dùng cần bảo vệ mật khẩu, OTP và thiết bị; thông báo kịp thời nếu nghi ngờ tài khoản bị chiếm dụng.",
    ],
  ),
  LegalPolicySection(
    title: "7. Lưu trữ, thời hạn và xóa dữ liệu",
    paragraphs: <String>[
      "Dữ liệu chỉ được giữ trong thời gian cần thiết cho mục đích hợp pháp, giao dịch còn hiệu lực, kiểm toán, giải quyết khiếu nại và các nghĩa vụ lưu trữ bắt buộc. thời hạn áp dụng được xác định theo mục đích của từng nhóm dữ liệu và nghĩa vụ lưu giữ theo pháp luật; người dùng có thể yêu cầu cung cấp chi tiết thời gian lưu của dữ liệu liên quan qua kênh Trợ giúp.",
      "Khi người dùng yêu cầu xóa tài khoản, hệ thống xử lý quyền đăng nhập và dữ liệu không còn căn cứ lưu giữ; hồ sơ đơn, tài chính, khiếu nại hoặc chứng từ có nghĩa vụ bảo lưu sẽ được giữ theo phạm vi/thời hạn pháp luật cho phép và hạn chế truy cập.",
      "Hết thời hạn lưu hoặc mục đích xử lý, dữ liệu phải được xóa, hủy hoặc áp dụng biện pháp khác theo pháp luật. Việc rút lại đồng ý không tự động xóa những dữ liệu vẫn phải lưu trên căn cứ pháp luật độc lập.",
    ],
  ),
  LegalPolicySection(
    title: "8. Quyền của người có dữ liệu",
    paragraphs: <String>[
      "Người dùng có thể yêu cầu biết, truy cập, xem, chỉnh sửa, cung cấp bản sao, rút lại sự đồng ý, phản đối hoặc hạn chế xử lý, yêu cầu xóa dữ liệu và các quyền khác trong phạm vi, điều kiện và thời hạn pháp luật quy định.",
      "Yêu cầu cần được gửi qua kênh tiếp nhận chính thức; khi cần, hệ thống có thể xác minh danh tính để tránh tiết lộ dữ liệu cho người không có quyền. Kết quả sẽ được phản hồi theo thời hạn pháp luật áp dụng.",
      "yêu cầu dữ liệu cá nhân và khiếu nại được tiếp nhận thông qua mục Trợ giúp của 11Food/11Ship, có thể cần xác minh danh tính trước khi xử lý.",
    ],
  ),
  LegalPolicySection(
    title: "9. Sự đồng ý và lựa chọn riêng",
    paragraphs: <String>[
      "Việc đồng ý Điều khoản sử dụng khi đăng ký là hành động xác nhận các điều kiện sử dụng dịch vụ; Chính sách quyền riêng tư được cung cấp để người dùng đọc đầy đủ thông tin xử lý dữ liệu.",
      "Khi một hoạt động xử lý dữ liệu yêu cầu sự đồng ý theo luật, hệ thống phải lấy và ghi nhận đồng ý phù hợp với mục đích cụ thể. Đối với tiếp thị, định vị không cần thiết hoặc chia sẻ tùy chọn, người dùng phải có lựa chọn riêng khi pháp luật yêu cầu.",
      "Việc từ chối hoạt động tùy chọn không được mặc nhiên làm mất khả năng sử dụng các chức năng không phụ thuộc vào hoạt động đó.",
    ],
  ),
  LegalPolicySection(
    title: "10. Dữ liệu của người chưa thành niên",
    paragraphs: <String>[
      "Việc tạo tài khoản, xử lý dữ liệu của người chưa thành niên và giao dịch liên quan phải đáp ứng yêu cầu về độ tuổi và sự đồng ý của chủ thể hoặc người đại diện theo pháp luật khi cần thiết.",
      "điều kiện độ tuổi và xác minh được áp dụng theo pháp luật đối với từng vai trò; những trường hợp cần người đại diện sẽ phải được xác minh trước khi xử lý dữ liệu.",
    ],
  ),
  LegalPolicySection(
    title: "11. Cập nhật chính sách và phiên bản",
    paragraphs: <String>[
      "Khi thay đổi mục đích hoặc cách xử lý dữ liệu quan trọng, hệ thống công khai phiên bản mới, thời điểm áp dụng và gửi thông báo phù hợp; nếu pháp luật yêu cầu, xin lại đồng ý trước khi xử lý theo mục đích mới.",
      "Các lần đồng ý, nếu có, được lưu theo thời điểm và phiên bản chính sách tương ứng. Phiên bản này áp dụng cho người dùng chấp thuận chính sách mới, không xóa lịch sử chấp thuận các phiên bản trước đó.",
    ],
  ),
  LegalPolicySection(
    title: "12. Liên hệ và giải quyết khiếu nại về dữ liệu",
    paragraphs: <String>[
      "Liên hệ đơn vị vận hành: yêu cầu thông tin đơn vị vận hành hoặc khiếu nại về dữ liệu cá nhân được gửi qua mục Trợ giúp của 11Food/11Ship.",
      "Người dùng có quyền khiếu nại hoặc yêu cầu cơ quan nhà nước có thẩm quyền xử lý theo pháp luật Việt Nam nếu cho rằng dữ liệu của mình bị sử dụng trái quy định.",
    ],
  ),
];
