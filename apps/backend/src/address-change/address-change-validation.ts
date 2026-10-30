import { AppError } from '../common/app-errors';

export interface CreateAddressChangeInput {
  readonly recipientName: string;
  readonly recipientPhone: string;
  readonly addressText: string;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly note: string | null;
  readonly expectedVersion: number;
}

export interface DecideAddressChangeInput {
  readonly accept: boolean;
  readonly reason: string | null;
  readonly expectedVersion: number;
}

export interface CancelAddressChangeInput {
  readonly expectedVersion: number;
}

export function parseCreateAddressChangeBody(body: unknown): CreateAddressChangeInput {
  if (body === null || typeof body !== 'object') {
    throw new AppError('DELIVERY_INPUT_INVALID');
  }
  const b = body as Record<string, unknown>;

  const recipientName = typeof b.recipient_name === 'string' ? b.recipient_name.trim() : '';
  if (!recipientName || recipientName.length > 80) {
    throw new AppError('DELIVERY_INPUT_INVALID');
  }

  const rawPhone = typeof b.recipient_phone === 'string' ? b.recipient_phone.trim() : '';
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) {
    throw new AppError('INVALID_PHONE');
  }
  const recipientPhone = digits.startsWith('84') ? `0${digits.slice(2)}` : digits.startsWith('0') ? digits : `0${digits}`;

  const addressText = typeof b.address_text === 'string' ? b.address_text.trim() : typeof b.dropoff_address_text === 'string' ? b.dropoff_address_text.trim() : '';
  if (!addressText || addressText.length > 300) {
    throw new AppError('DELIVERY_INPUT_INVALID');
  }

  const rawLat = b.lat ?? b.dropoff_lat;
  const rawLng = b.lng ?? b.dropoff_lng;
  let lat: number | null = null;
  let lng: number | null = null;
  if (rawLat !== null && rawLat !== undefined && rawLng !== null && rawLng !== undefined) {
    const parsedLat = Number(rawLat);
    const parsedLng = Number(rawLng);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng) || parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
      throw new AppError('DELIVERY_INPUT_INVALID');
    }
    lat = parsedLat;
    lng = parsedLng;
  } else if ((rawLat !== null && rawLat !== undefined) !== (rawLng !== null && rawLng !== undefined)) {
    throw new AppError('DELIVERY_INPUT_INVALID');
  }

  const rawNote = typeof b.note === 'string' ? b.note.trim() : null;
  const note = rawNote && rawNote.length <= 200 ? rawNote : null;

  const rawVersion = b.expected_version ?? b.version;
  const expectedVersion = Number(rawVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new AppError('VERSION_CONFLICT');
  }

  return { recipientName, recipientPhone, addressText, lat, lng, note, expectedVersion };
}

export function parseDecideAddressChangeBody(body: unknown): DecideAddressChangeInput {
  if (body === null || typeof body !== 'object') {
    throw new AppError('DELIVERY_INPUT_INVALID');
  }
  const b = body as Record<string, unknown>;
  if (typeof b.accept !== 'boolean') {
    throw new AppError('DELIVERY_INPUT_INVALID');
  }
  const rawReason = typeof b.reason === 'string' ? b.reason.trim() : null;
  const reason = rawReason && rawReason.length <= 200 ? rawReason : null;

  const rawVersion = b.expected_version ?? b.version;
  const expectedVersion = Number(rawVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new AppError('VERSION_CONFLICT');
  }

  return { accept: b.accept, reason, expectedVersion };
}

export function parseCancelAddressChangeBody(body: unknown): CancelAddressChangeInput {
  if (body === null || typeof body !== 'object') {
    throw new AppError('DELIVERY_INPUT_INVALID');
  }
  const b = body as Record<string, unknown>;
  const rawVersion = b.expected_version ?? b.version;
  const expectedVersion = Number(rawVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new AppError('VERSION_CONFLICT');
  }
  return { expectedVersion };
}
