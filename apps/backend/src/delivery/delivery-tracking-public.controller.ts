import { Controller, Get, Header, Param } from '@nestjs/common';
import { DeliveryCustomerService, PublicTrackResult } from './delivery-customer-service';

@Controller()
export class DeliveryTrackingPublicController {
  constructor(private readonly customer: DeliveryCustomerService) {}

  @Get('public/tracking/:token')
  async getStatus(@Param('token') token: string): Promise<{ data: PublicTrackResult }> {
    const data = await this.customer.publicTrack(token);
    return { data };
  }

  @Get('track/:token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async renderHtml(@Param('token') token: string): Promise<string> {
    const data: PublicTrackResult = await this.customer.publicTrack(token);
    const isExpired = data.status === 'EXPIRED';
    const title = isExpired ? 'Chuyến giao kết thúc — 11Ship' : `Theo dõi đơn ${data.code ?? ''} — 11Ship`;
    const loc = data.location;

    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: #f4f6f8; color: #1e293b; display: flex; justify-content: center; padding: 16px; }
    .card { background: #fff; width: 100%; max-width: 480px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); overflow: hidden; }
    .header { background: #0284c7; color: #fff; padding: 20px; text-align: center; }
    .header h1 { font-size: 20px; font-weight: 700; }
    .header p { font-size: 14px; opacity: 0.9; margin-top: 4px; }
    .content { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
    .row { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px; }
    .row:last-child { border-bottom: none; }
    .label { font-size: 14px; color: #64748b; }
    .value { font-size: 15px; font-weight: 600; color: #0f172a; text-align: right; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; }
    .badge-active { background: #e0f2fe; color: #0369a1; }
    .badge-expired { background: #f1f5f9; color: #64748b; }
    .badge-success { background: #dcfce7; color: #15803d; }
    .alert { padding: 14px; border-radius: 8px; font-size: 14px; text-align: center; background: #fef2f2; color: #b91c1c; }
    .map-box { background: #e2e8f0; height: 180px; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #64748b; font-size: 14px; text-align: center; padding: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>11Ship — Theo dõi đơn hàng</h1>
      <p id="sub-header">${isExpired ? 'Liên kết đã hết hiệu lực' : 'Đang cập nhật trực tiếp'}</p>
    </div>
    <div class="content">
      ${isExpired ? `<div class="alert">${data.message ?? 'Chuyến giao đã kết thúc hoặc liên kết bị thu hồi.'}</div>` : `
        <div class="row">
          <span class="label">Mã chuyến:</span>
          <span class="value" id="val-code">${data.code ?? '—'}</span>
        </div>
        <div class="row">
          <span class="label">Trạng thái:</span>
          <span class="badge badge-active" id="val-state">${data.state ?? 'Đang xử lý'}</span>
        </div>
        <div class="row">
          <span class="label">Hàng hóa:</span>
          <span class="value" id="val-goods">${data.goods_description ?? '—'}</span>
        </div>
        <div class="row">
          <span class="label">Tiền thu hộ (COD):</span>
          <span class="value" id="val-cod">${Number(data.cod_vnd ?? 0).toLocaleString('vi-VN')} đ</span>
        </div>
        <div class="row">
          <span class="label">Người nhận cần trả:</span>
          <span class="value" id="val-pays" style="color: #b91c1c;">${data.recipient_pays_vnd !== null && data.recipient_pays_vnd !== undefined ? Number(data.recipient_pays_vnd).toLocaleString('vi-VN') + ' đ' : 'Chưa chốt'}</span>
        </div>
        <div id="location-container">
          ${loc ? `
            <div class="map-box">
              📍 Vị trí tài xế: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}<br>
              <small>Cập nhật: ${new Date(loc.recorded_at).toLocaleTimeString('vi-VN')} ${loc.is_stale ? '(Tín hiệu yếu)' : ''}</small>
            </div>
          ` : `
            <div class="map-box">
              Không chia sẻ vị trí trực tiếp
            </div>
          `}
        </div>
      `}
    </div>
  </div>
  <script>
    const token = ${JSON.stringify(token)};
    if (!${isExpired}) {
      setInterval(async () => {
        try {
          const res = await fetch('/public/tracking/' + token);
          if (!res.ok) return;
          const json = await res.json();
          if (json.data && json.data.status === 'EXPIRED') {
            window.location.reload();
          }
        } catch (_) {}
      }, 10000);
    }
  </script>
</body>
</html>`;
  }
}
