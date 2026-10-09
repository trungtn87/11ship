import { checkHealth, validateOrigin } from './health.mjs';
const button = document.querySelector('#check');
const result = document.querySelector('#result');
const origin = window.SHIP_FOUNDATION_CONFIG?.apiOrigin ?? '';
const messages = { READY: 'API và database sẵn sàng.', NOT_CONFIGURED: 'Chưa cấu hình backend. Liên hệ người triển khai.', NOT_READY: 'API chưa sẵn sàng hoặc database chưa kết nối.', UNAVAILABLE: 'API chưa hoạt động.', INVALID_RESPONSE: 'Phản hồi không đúng hợp đồng API.', TIMEOUT: 'Kiểm tra quá thời gian. Bạn có thể thử lại.', NETWORK_OR_CORS: 'Không kết nối được. Cần kiểm tra mạng hoặc cấu hình CORS.' };
try { const target = validateOrigin(origin); document.querySelector('#target').textContent = target ?? 'Chưa cấu hình địa chỉ backend.'; }
catch { result.textContent = 'Cấu hình backend không hợp lệ.'; button.disabled = true; }
button.addEventListener('click', async () => {
  button.disabled = true; result.textContent = 'Đang kiểm tra…';
  try { result.textContent = messages[(await checkHealth(origin)).code]; }
  catch { result.textContent = 'Cấu hình backend không hợp lệ.'; }
  finally { button.disabled = false; }
});
