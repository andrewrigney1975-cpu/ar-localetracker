// Notices when the user leaves their routine's usual route: more than 250 m away from it for
// more than 2 minutes of active time. Fires once. Mirrors RouteGuard.java.

import { distanceToPolyline } from './routines.js';

export const OFF_ROUTE_M = 250;
export const OFF_ROUTE_MS = 120000;

export class RouteGuard {
  /** @param {number[][]} signature [[lat, lon], ...] */
  constructor(signature) {
    this.signature = signature;
    this.offSince = -1;
    this.fired = false;
  }

  /** @returns {boolean} true exactly once, when the user has been off the route long enough */
  onFix(lat, lon, activeElapsedMs) {
    if (this.fired) return false;
    if (distanceToPolyline(lat, lon, this.signature) <= OFF_ROUTE_M) {
      this.offSince = -1;
      return false;
    }
    if (this.offSince < 0) this.offSince = activeElapsedMs;
    if (activeElapsedMs - this.offSince >= OFF_ROUTE_MS) {
      this.fired = true;
      return true;
    }
    return false;
  }
}
