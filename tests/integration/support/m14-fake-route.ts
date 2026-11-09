import { encodePolyline6 } from '../../../apps/backend/src/delivery/m14-route-client';

// The answer a fake M14 routing service gives in integration tests: the same shape as ops/m14/server.py (engine trip with ONE leg shape, plus route_version).
// M14RouteClient refuses an answer without a valid shape, so every fake routing server in tests/integration builds its reply here.
export const FAKE_ROUTE_VERSION = 'valhalla-3.9.1/motorcycle-shortest/test';
const SHAPE = encodePolyline6([{ lat: 22.665, lng: 106.258 }, { lat: 22.674, lng: 106.251 }, { lat: 22.682, lng: 106.245 }]);

export function m14RouteAnswer(lengthKm: number, timeSeconds = 420): unknown {
  return { trip: { summary: { length: lengthKm, time: timeSeconds }, legs: [{ shape: SHAPE }] }, route_version: FAKE_ROUTE_VERSION };
}
