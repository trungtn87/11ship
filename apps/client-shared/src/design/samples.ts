import type { SampleData } from '../screen.js';

// The only place sample people and shops live. Design preview only (the real build deletes this folder).
export const SAMPLE: SampleData = {
  person: { fullName: 'Nguyễn Văn A', phoneMasked: '098 •••• 123' },
  shop: { name: 'Quán Cơm Nhà', phone: '0981234123', address: '12 đường Kim Đồng, phường Hợp Giang' },
  location: { accuracy: '± 8 m (mẫu)', measured: 'vừa xong (mẫu)' },
};
