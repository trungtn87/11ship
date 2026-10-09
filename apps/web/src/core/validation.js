// Client-side validation. It only helps the person fix a form before sending: the backend decides (strict parsers in
// apps/backend/src/auth/auth-validation.ts and onboarding/*-validation.ts). The limits below mirror those parsers, and
// a request body is built ONLY from the validated values as a frozen snapshot, never read again from the live form.

export const LIMITS = Object.freeze({
  shopName: 120,
  shopZalo: 160,
  shopFacebook: 300,
  shopAddress: 500,
  driverFullName: 120,
  driverPlate: 32,
  loginPassword: 1024,
});

const VIETNAM_MOBILE = /^(?:\+84|84|0)([0-9]{9})$/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function charCount(text) {
  return [...text].length;
}

/** Spaces, dots and dashes people type inside a number are dropped; the backend accepts no separators at all. */
export function normalizePhoneInput(raw) {
  if (typeof raw !== 'string' || raw.length > 64) {
    return null;
  }
  const compact = raw.replace(/[\s.-]/g, '');
  const match = VIETNAM_MOBILE.exec(compact);
  return match === null ? null : `+84${match[1]}`;
}

function wellFormed(text) {
  return !LONE_SURROGATE.test(text) && !text.includes('\u0000');
}

/** Outer-trimmed non-empty text within `max` characters, or an error message. */
function boundedText(raw, max, label) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') {
    return { error: `Nhập ${label}.` };
  }
  if (!wellFormed(text)) {
    return { error: `${label[0].toUpperCase()}${label.slice(1)} có ký tự không hợp lệ.` };
  }
  if (charCount(text) > max) {
    return { error: `${label[0].toUpperCase()}${label.slice(1)} tối đa ${max} ký tự.` };
  }
  return { value: text };
}

function optionalText(raw, max, label) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') {
    return { value: null };
  }
  return boundedText(text, max, label);
}

function coordinate(raw, limit, label) {
  const text = typeof raw === 'string' ? raw.trim().replace(',', '.') : '';
  if (text === '') {
    return { value: null };
  }
  if (!/^-?[0-9]+(\.[0-9]+)?$/.test(text)) {
    return { error: `${label} phải là số, ví dụ 22.6657.` };
  }
  const number = Number(text);
  if (!Number.isFinite(number) || Math.abs(number) > limit) {
    return { error: `${label} phải nằm trong khoảng -${limit} đến ${limit}.` };
  }
  return { value: number === 0 ? 0 : number };
}

export function validateLogin(form) {
  const errors = {};
  const phone = normalizePhoneInput(form.phone);
  if (phone === null) {
    errors.phone = 'Số điện thoại chưa hợp lệ. Nhập số di động Việt Nam, ví dụ 0912345678.';
  }
  const password = typeof form.password === 'string' ? form.password : '';
  if (password === '') {
    errors.password = 'Nhập mật khẩu.';
  } else if (!wellFormed(password) || password.length > LIMITS.loginPassword) {
    errors.password = 'Mật khẩu chưa hợp lệ.';
  }
  return Object.keys(errors).length > 0 ? { errors } : { errors, value: Object.freeze({ phone, password }) };
}

/**
 * form: strings as typed. expectedVersion: null when creating, the saved version when updating a draft.
 * The body keeps the backend's field names; empty optional values are sent as null (full replacement).
 */
export function validateShopProfile(form, expectedVersion) {
  const errors = {};
  const name = boundedText(form.name, LIMITS.shopName, 'tên quán');
  if (name.error) errors.name = name.error;

  const contact = normalizePhoneInput(form.contact_phone);
  if (contact === null) {
    errors.contact_phone = 'Số điện thoại liên hệ chưa hợp lệ. Nhập số di động Việt Nam, ví dụ 0912345678.';
  }
  const address = boundedText(form.address_text, LIMITS.shopAddress, 'địa chỉ');
  if (address.error) errors.address_text = address.error;
  const zalo = optionalText(form.zalo, LIMITS.shopZalo, 'Zalo');
  if (zalo.error) errors.zalo = zalo.error;
  const facebook = optionalText(form.facebook, LIMITS.shopFacebook, 'Facebook');
  if (facebook.error) errors.facebook = facebook.error;

  const lat = coordinate(form.pickup_lat, 90, 'Vĩ độ');
  const lng = coordinate(form.pickup_lng, 180, 'Kinh độ');
  if (lat.error) errors.pickup_lat = lat.error;
  if (lng.error) errors.pickup_lng = lng.error;
  if (!lat.error && !lng.error && (lat.value === null) !== (lng.value === null)) {
    // One coordinate without the other is not a point (the backend refuses it too).
    if (lat.value === null) errors.pickup_lat = 'Nhập cả vĩ độ và kinh độ.';
    else errors.pickup_lng = 'Nhập cả vĩ độ và kinh độ.';
  }

  let serviceAreaId = null;
  const areaText = typeof form.service_area_id === 'string' ? form.service_area_id.trim().toLowerCase() : '';
  if (areaText !== '') {
    if (CANONICAL_UUID.test(areaText)) {
      serviceAreaId = areaText;
    } else {
      errors.service_area_id = 'Mã khu vực phục vụ không đúng định dạng.';
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }
  const body = {
    name: name.value,
    contact_phone: contact,
    address_text: address.value,
    zalo: zalo.value,
    facebook: facebook.value,
    pickup_lat: lat.value,
    pickup_lng: lng.value,
    service_area_id: serviceAreaId,
  };
  if (expectedVersion !== null) {
    body.expected_version = expectedVersion;
  }
  return { errors, value: Object.freeze(body) };
}

export function validateDriver(form) {
  const errors = {};
  const fullName = boundedText(form.full_name, LIMITS.driverFullName, 'họ tên');
  if (fullName.error) errors.full_name = fullName.error;
  const plate = optionalText(form.plate_number, LIMITS.driverPlate, 'biển số xe');
  if (plate.error) errors.plate_number = plate.error;
  if (Object.keys(errors).length > 0) {
    return { errors };
  }
  return { errors, value: Object.freeze({ full_name: fullName.value, plate_number: plate.value }) };
}
