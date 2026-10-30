import { BadRequestException, Controller, Get, Header, HttpException, HttpStatus, Param, Req, Res } from '@nestjs/common';
import { DeliveryCustomerService, PublicTrackResult } from './delivery-customer-service';

interface HttpRequest {
  ip?: string;
  socket?: { remoteAddress?: string };
}

interface HttpResponse {
  setHeader(name: string, value: string): unknown;
  status?(code: number): unknown;
}

function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,80}$/;

// In-memory rate limiter: 60 requests per minute per IP
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): void {
  const now = Date.now();
  const record = rateLimits.get(ip);
  if (!record || now > record.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + 60_000 });
    return;
  }
  record.count += 1;
  if (record.count > 60) {
    throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
  }
}

function applySecurityHeaders(res: HttpResponse): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

@Controller()
export class DeliveryTrackingPublicController {
  constructor(private readonly customer: DeliveryCustomerService) {}

  @Get('public/tracking/:token')
  async getStatus(@Param('token') token: string, @Req() req: HttpRequest, @Res({ passthrough: true }) res: HttpResponse): Promise<{ data: PublicTrackResult }> {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    checkRateLimit(ip);
    applySecurityHeaders(res);

    if (!TOKEN_PATTERN.test(token)) {
      throw new BadRequestException('Mã theo dõi không hợp lệ');
    }

    const data = await this.customer.publicTrack(token);
    return { data };
  }

  @Get('track/:token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async renderHtml(@Param('token') token: string, @Req() req: HttpRequest, @Res({ passthrough: true }) res: HttpResponse): Promise<string> {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    checkRateLimit(ip);
    applySecurityHeaders(res);

    if (!TOKEN_PATTERN.test(token)) {
      throw new BadRequestException('Mã theo dõi không hợp lệ');
    }

    const data: PublicTrackResult = await this.customer.publicTrack(token);
    const isExpired = data.status === 'EXPIRED';
    const loc = data.location;
    const title = isExpired ? 'Chuyến giao kết thúc — 11Ship' : `Theo dõi đơn ${escapeHtml(data.code ?? '')} — 11Ship`;

    const stateLabels: Record<string, string> = {
      waiting_driver: 'Đang tìm tài xế',
      accepted: 'Tài xế đã nhận chuyến',
      location_confirmed: 'Tài xế đang tới điểm lấy hàng',
      picked_up: 'Đã lấy hàng — Đang giao',
      delivering: 'Đang giao hàng',
      completed: 'Hoàn thành',
      failed: 'Giao thất bại',
      cancelled_by_merchant: 'Đã hủy',
      cancelled_by_system: 'Hệ thống đã hủy',
      search_stopped: 'Dừng tìm kiếm',
    };

    const currentStateLabel = data.state ? (stateLabels[data.state] ?? data.state) : 'Đang xử lý';

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
  <meta name="referrer" content="no-referrer">
  <title>${title}</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: #f4f6f8; color: #1e293b; display: flex; justify-content: center; padding: 16px; min-height: 100vh; }
    .card { background: #fff; width: 100%; max-width: 480px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); overflow: hidden; height: fit-content; }
    .header { background: #0284c7; color: #fff; padding: 20px; text-align: center; }
    .header h1 { font-size: 20px; font-weight: 700; }
    .header p { font-size: 14px; opacity: 0.9; margin-top: 4px; }
    .content { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
    .row { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px; }
    .row:last-child { border-bottom: none; }
    .label { font-size: 14px; color: #64748b; }
    .value { font-size: 15px; font-weight: 600; color: #0f172a; text-align: right; word-break: break-word; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; }
    .badge-active { background: #e0f2fe; color: #0369a1; }
    .alert { padding: 16px; border-radius: 8px; font-size: 14px; text-align: center; background: #fef2f2; color: #b91c1c; font-weight: 500; }
    #map { height: 220px; width: 100%; border-radius: 8px; margin-top: 8px; border: 1px solid #cbd5e1; }
    .map-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; font-size: 13px; color: #475569; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>11Ship — Theo dõi đơn hàng</h1>
      <p id="sub-header">${isExpired ? 'Liên kết đã hết hiệu lực' : 'Đang cập nhật trực tiếp'}</p>
    </div>
    <div class="content" id="main-content">
      ${isExpired ? `<div class="alert">${escapeHtml(data.message ?? 'Chuyến giao đã kết thúc hoặc liên kết bị thu hồi.')}</div>` : `
        <div class="row">
          <span class="label">Mã chuyến:</span>
          <span class="value" id="val-code">${escapeHtml(data.code ?? '—')}</span>
        </div>
        <div class="row">
          <span class="label">Trạng thái:</span>
          <span class="badge badge-active" id="val-state">${escapeHtml(currentStateLabel)}</span>
        </div>
        <div class="row">
          <span class="label">Hàng hóa:</span>
          <span class="value" id="val-goods">${escapeHtml(data.goods_description ?? '—')}</span>
        </div>
        <div class="row">
          <span class="label">Tiền thu hộ (COD):</span>
          <span class="value" id="val-cod">${Number(data.cod_vnd ?? 0).toLocaleString('vi-VN')} đ</span>
        </div>
        <div class="row">
          <span class="label">Người nhận cần trả:</span>
          <span class="value" id="val-pays" style="color: #b91c1c;">${data.recipient_pays_vnd !== null && data.recipient_pays_vnd !== undefined ? Number(data.recipient_pays_vnd).toLocaleString('vi-VN') + ' đ' : 'Chưa chốt'}</span>
        </div>
        <div id="location-wrapper">
          <div class="map-box">
            <div id="loc-text">${loc ? `📍 Vị trí tài xế: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)} (${loc.is_stale ? 'Tín hiệu yếu' : 'Đang di chuyển'})` : 'Vị trí trực tiếp: Người gửi chưa bật chia sẻ vị trí'}</div>
            <div id="map" style="${loc ? 'display:block;' : 'display:none;'}"></div>
          </div>
        </div>
      `}
    </div>
  </div>
  <script>
    const token = ${JSON.stringify(token)};
    let isExpired = ${JSON.stringify(isExpired)};
    let map = null;
    let marker = null;

    const STATE_LABELS = ${JSON.stringify(stateLabels)};

    function initMap(lat, lng) {
      if (typeof L === 'undefined') return;
      const mapEl = document.getElementById('map');
      if (!mapEl) return;
      mapEl.style.display = 'block';
      if (!map) {
        map = L.map('map').setView([lat, lng], 15);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap'
        }).addTo(map);
        marker = L.marker([lat, lng]).addTo(map);
      } else {
        marker.setLatLng([lat, lng]);
        map.panTo([lat, lng]);
      }
    }

    ${loc ? `initMap(${loc.lat}, ${loc.lng});` : ''}

    function wipeSensitiveData(message) {
      isExpired = true;
      if (map) {
        map.remove();
        map = null;
      }
      document.getElementById('sub-header').innerText = 'Liên kết đã hết hiệu lực';
      const content = document.getElementById('main-content');
      if (content) {
        content.innerHTML = '<div class="alert">' + (message || 'Chuyến giao đã kết thúc hoặc liên kết bị thu hồi.') + '</div>';
      }
    }

    if (!isExpired) {
      const pollTimer = setInterval(async () => {
        try {
          const res = await fetch('/v1/public/tracking/' + encodeURIComponent(token));
          if (!res.ok) {
            if (res.status === 400 || res.status === 404) {
              clearInterval(pollTimer);
              wipeSensitiveData('Liên kết theo dõi không tồn tại hoặc đã hết hiệu lực');
            }
            return;
          }
          const json = await res.json();
          const d = json.data;
          if (!d || d.status === 'EXPIRED') {
            clearInterval(pollTimer);
            wipeSensitiveData(d ? d.message : null);
            return;
          }

          // Active update
          const stateEl = document.getElementById('val-state');
          if (stateEl && d.state) {
            stateEl.innerText = STATE_LABELS[d.state] || d.state;
          }
          const codEl = document.getElementById('val-cod');
          if (codEl && d.cod_vnd !== undefined) {
            codEl.innerText = Number(d.cod_vnd || 0).toLocaleString('vi-VN') + ' đ';
          }
          const paysEl = document.getElementById('val-pays');
          if (paysEl) {
            paysEl.innerText = (d.recipient_pays_vnd !== null && d.recipient_pays_vnd !== undefined)
              ? Number(d.recipient_pays_vnd).toLocaleString('vi-VN') + ' đ'
              : 'Chưa chốt';
          }

          const locText = document.getElementById('loc-text');
          const mapEl = document.getElementById('map');
          if (d.location) {
            if (locText) {
              locText.innerText = '📍 Vị trí tài xế: ' + d.location.lat.toFixed(5) + ', ' + d.location.lng.toFixed(5) + (d.location.is_stale ? ' (Tín hiệu yếu)' : ' (Đang di chuyển)');
            }
            initMap(d.location.lat, d.location.lng);
          } else {
            if (locText) {
              locText.innerText = 'Vị trí trực tiếp: Người gửi chưa bật chia sẻ vị trí';
            }
            if (mapEl) {
              mapEl.style.display = 'none';
            }
          }
        } catch (_) {}
      }, 5000);
    }
  </script>
</body>
</html>`;

    return html;
  }
}
