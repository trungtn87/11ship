import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePhoneInput, validateDriver, validateLogin, validateShopProfile } from '../../apps/web/src/core/validation.js';

const validShop = {
  name: ' Quán Cô Ba ',
  contact_phone: '0912 345 678',
  address_text: ' 12 Phố Xanh, Cao Bằng ',
  zalo: '',
  facebook: '  ',
  pickup_lat: '22,6657',
  pickup_lng: '106.2522',
  service_area_id: ' 0A1B2C3D-0000-4000-8000-000000000001 ',
};

test('phone: the three accepted shapes normalize to +84, separators typed by people are dropped', () => {
  for (const input of ['0912345678', '84912345678', '+84912345678', '0912 345 678', '0912.345.678', '0912-345-678', ' 0912345678 ']) {
    assert.equal(normalizePhoneInput(input), '+84912345678', input);
  }
  for (const input of ['', '091234567', '09123456789', '+8491234567x', '٠٩١٢٣٤٥٦٧٨', '+1 415 555 0100', undefined, null, 5]) {
    assert.equal(normalizePhoneInput(input), null, String(input));
  }
});

test('login: needs a valid phone and a non-empty password; the password is never trimmed or altered', () => {
  const ok = validateLogin({ phone: '0912345678', password: '  spaced pw  ' });
  assert.deepEqual({ ...ok.value }, { phone: '+84912345678', password: '  spaced pw  ' });
  assert.ok(Object.isFrozen(ok.value));
  const bad = validateLogin({ phone: '12', password: '' });
  assert.equal(bad.value, undefined);
  assert.ok(bad.errors.phone && bad.errors.password);
  assert.ok(validateLogin({ phone: '0912345678', password: 'x'.repeat(1025) }).errors.password);
  assert.ok(validateLogin({ phone: '0912345678', password: 'bad\uD800' }).errors.password);
});

test('shop profile: body uses backend field names, trims, nulls empties, lowercases the area id', () => {
  const checked = validateShopProfile(validShop, null);
  assert.deepEqual({ ...checked.value }, {
    name: 'Quán Cô Ba',
    contact_phone: '+84912345678',
    address_text: '12 Phố Xanh, Cao Bằng',
    zalo: null,
    facebook: null,
    pickup_lat: 22.6657,
    pickup_lng: 106.2522,
    service_area_id: '0a1b2c3d-0000-4000-8000-000000000001',
  });
  assert.equal('expected_version' in checked.value, false);
  assert.ok(Object.isFrozen(checked.value));
  assert.equal(validateShopProfile(validShop, 3).value.expected_version, 3);
});

test('shop profile: required fields, limits, coordinates in pairs and ranges, area id shape', () => {
  assert.ok(validateShopProfile({ ...validShop, name: ' ' }, null).errors.name);
  assert.ok(validateShopProfile({ ...validShop, name: 'x'.repeat(121) }, null).errors.name);
  assert.equal(validateShopProfile({ ...validShop, name: 'x'.repeat(120) }, null).errors.name, undefined);
  assert.equal(validateShopProfile({ ...validShop, name: '😀'.repeat(120) }, null).errors.name, undefined); // counted in characters, as varchar counts
  assert.ok(validateShopProfile({ ...validShop, contact_phone: '123' }, null).errors.contact_phone);
  assert.ok(validateShopProfile({ ...validShop, address_text: 'x'.repeat(501) }, null).errors.address_text);
  assert.ok(validateShopProfile({ ...validShop, zalo: 'z'.repeat(161) }, null).errors.zalo);
  assert.ok(validateShopProfile({ ...validShop, facebook: 'f'.repeat(301) }, null).errors.facebook);
  assert.ok(validateShopProfile({ ...validShop, pickup_lat: '91' }, null).errors.pickup_lat);
  assert.ok(validateShopProfile({ ...validShop, pickup_lng: '181' }, null).errors.pickup_lng);
  assert.ok(validateShopProfile({ ...validShop, pickup_lat: 'abc' }, null).errors.pickup_lat);
  assert.ok(validateShopProfile({ ...validShop, pickup_lat: '1e3' }, null).errors.pickup_lat);
  assert.ok(validateShopProfile({ ...validShop, pickup_lng: '' }, null).errors.pickup_lng); // one coordinate alone is not a point
  assert.ok(validateShopProfile({ ...validShop, pickup_lat: '' }, null).errors.pickup_lat);
  assert.ok(validateShopProfile({ ...validShop, service_area_id: 'not-a-uuid' }, null).errors.service_area_id);
  const noGps = validateShopProfile({ ...validShop, pickup_lat: '', pickup_lng: '', service_area_id: '' }, null);
  assert.equal(noGps.value.pickup_lat, null);
  assert.equal(noGps.value.pickup_lng, null);
  assert.equal(noGps.value.service_area_id, null);
  assert.equal(validateShopProfile({ ...validShop, pickup_lat: '-0', pickup_lng: '0' }, null).value.pickup_lat, 0);
});

test('driver: full name required, plate optional, both bounded', () => {
  assert.deepEqual({ ...validateDriver({ full_name: ' Nguyễn Văn A ', plate_number: '' }).value }, { full_name: 'Nguyễn Văn A', plate_number: null });
  assert.deepEqual({ ...validateDriver({ full_name: 'A', plate_number: ' 11A-123.45 ' }).value }, { full_name: 'A', plate_number: '11A-123.45' });
  assert.ok(validateDriver({ full_name: '', plate_number: '' }).errors.full_name);
  assert.ok(validateDriver({ full_name: 'x'.repeat(121), plate_number: '' }).errors.full_name);
  assert.ok(validateDriver({ full_name: 'A', plate_number: 'p'.repeat(33) }).errors.plate_number);
  // The superseded service_area_ids of the old Driver design is simply not part of the body.
  assert.equal('service_area_ids' in validateDriver({ full_name: 'A', plate_number: '' }).value, false);
});
