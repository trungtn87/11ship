import { Controller, Get, Res } from '@nestjs/common';
import { TERMS_PAGE_HTML, TERMS_PAGE_PATH, TERMS_PAGE_VERSION } from './terms-page';

interface PageResponse {
  setHeader(name: string, value: string): unknown;
}

/** Public, static, read-only terms draft; no auth, cookies, request body or DB dependency. */
@Controller(TERMS_PAGE_PATH)
export class TermsPageController {
  @Get()
  page(@Res({ passthrough: true }) response: PageResponse): string {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    response.setHeader('X-Terms-Version', TERMS_PAGE_VERSION);
    return TERMS_PAGE_HTML;
  }
}
