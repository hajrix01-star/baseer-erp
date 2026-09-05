import { ForbiddenException, Injectable } from "@nestjs/common";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";

@Injectable()
export class MarketingGoogleOAuthService {
  /**
   * This service is deliberately hard-off until MKT-01B supplies the missing
   * callback, permanent credential vault, explicit resource selection,
   * revocation and pilot controls.  The second guard prevents an internal
   * caller from bypassing the controller's release boundary.
   */
  async begin(_context: TrustedCompanyActorContext, _provider: "GOOGLE_ADS" | "GOOGLE_BUSINESS"): Promise<never> {
    throw new ForbiddenException("Google authorization is not available in this Baseer release.");
  }
}
