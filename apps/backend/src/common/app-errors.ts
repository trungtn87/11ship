// Typed application errors. Every error that may reach a client has a FIXED code, HTTP status and
// message defined here. Nothing from a thrown exception (message, details, extra "code" fields) is
// ever copied into a response: classification looks at the class of the exception, not its content.

export const APP_ERROR_DEFINITIONS = {
  IDEMPOTENCY_KEY_REQUIRED: { status: 400, message: 'Idempotency-Key header is required' },
  INVALID_IDEMPOTENCY_KEY: { status: 400, message: 'Idempotency-Key is invalid' },
  IDEMPOTENCY_KEY_REUSED: {
    status: 409,
    message: 'Idempotency-Key was already used with a different request',
  },
  IDEMPOTENCY_BUSY: {
    status: 409,
    message: 'A request with this Idempotency-Key is already in progress',
  },
  IDEMPOTENCY_REPLAY_EXPIRED: {
    status: 409,
    message: 'The replay window for this Idempotency-Key has expired',
  },
  IDEMPOTENCY_KEY_UNAVAILABLE: {
    status: 503,
    message: 'Idempotency protection is temporarily unavailable',
  },
  TRANSACTION_OUTCOME_UNKNOWN: {
    status: 503,
    message: 'The outcome of the operation could not be determined',
  },

  // Auth Core (M01-A1, task section 15). Fixed messages: they never echo a phone number, an OTP, a token or
  // anything else the client sent, and they never say whether an account exists.
  LOGIN_RATE_LIMITED: { status: 429, message: 'Too many login attempts; try again later' },
  INVALID_PHONE: { status: 400, message: 'The phone number is not valid' },
  OTP_INVALID: { status: 400, message: 'The verification code is not correct' },
  OTP_EXPIRED: { status: 400, message: 'The verification code has expired' },
  OTP_ALREADY_USED: { status: 409, message: 'The verification code was already used' },
  OTP_RATE_LIMITED: {
    status: 429,
    message: 'Too many verification requests or attempts; try again later',
  },
  // The OTP challenge is closed after too many wrong codes (distinct from OTP_RATE_LIMITED: the send quota / cooldown). The client starts the flow again.
  OTP_LOCKED: { status: 429, message: 'Too many wrong verification codes; request a new code' },
  OTP_POLICY_VERSION_CONFLICT: { status: 409, message: 'The SMS OTP settings were changed by another request' },
  PHONE_ALREADY_REGISTERED: { status: 409, message: 'This phone number is already registered' },
  // The phone belongs to an account locked at its owner's request: it can be recovered through the OTP-proven recovery flow.
  ACCOUNT_RECOVERY_AVAILABLE: { status: 409, message: 'This account can be recovered with phone verification' },
  VERIFICATION_PROOF_INVALID: { status: 400, message: 'The verification proof is not valid' },
  VERIFICATION_PROOF_USED: { status: 409, message: 'The verification proof was already used' },
  VERIFICATION_PURPOSE_MISMATCH: {
    status: 400,
    message: 'The verification was issued for a different purpose',
  },
  CURRENT_PASSWORD_INVALID: { status: 400, message: 'The current password is not correct' },
  INVALID_CREDENTIALS: { status: 401, message: 'The phone number or password is not correct' },
  ACCOUNT_DISABLED: { status: 403, message: 'This account is disabled' },
  ROLE_NOT_AVAILABLE: { status: 403, message: 'The requested role is not available' },
  SESSION_INVALID: { status: 401, message: 'The session is not valid' },
  SESSION_REVOKED: { status: 401, message: 'The session was revoked' },
  SESSION_EXPIRED: { status: 401, message: 'The session has expired' },
  // M00-D2: staging fixture mode closes OTP request/verify and register (no SMS exists there yet). Fixed message:
  // it says nothing about phones, accounts or configuration.
  AUTH_REGISTRATION_UNAVAILABLE: {
    status: 503,
    message: 'Registration and phone verification are temporarily unavailable',
  },

  // SMS gateway (issue #102). Fixed messages; a bad, revoked or unknown credential/job is never told apart.
  GATEWAY_UNAUTHORIZED: { status: 401, message: 'The gateway credential is not valid' },
  GATEWAY_JOB_NOT_FOUND: { status: 404, message: 'The job was not found for this gateway attempt' },
  GATEWAY_ACK_CONFLICT: { status: 409, message: 'The job already has a different final result' },

  // Shop onboarding (M01-A2S, handoff section 10). Fixed messages: they never echo what the client sent,
  // never name a database constraint and never reveal another account's data.
  SHOP_ONBOARDING_EXISTS: { status: 409, message: 'A shop profile already exists for this account' },
  SHOP_PROFILE_INCOMPLETE: { status: 409, message: 'The shop profile is not ready to be completed' },
  INVALID_SERVICE_AREA: { status: 400, message: 'The service area is not valid' },
  VERSION_CONFLICT: { status: 409, message: 'The resource was changed by another request' },

  // Driver onboarding (M01-A2D, task section 14). Same rule: fixed messages that echo nothing the client sent
  // and reveal nothing about any other account. INVALID_SERVICE_AREA (above) also serves the Driver areas.
  DRIVER_PROFILE_EXISTS: { status: 409, message: 'A driver profile already exists for this account' },
  DRIVER_PENDING_APPROVAL: { status: 403, message: 'The driver profile is waiting for approval' },

  // Shipper management (M03). Same rule: fixed messages that echo nothing the client sent (no name, number or reason).
  DRIVER_NOT_FOUND: { status: 404, message: 'The Shipper was not found' },
  DRIVER_STATE_CONFLICT: { status: 409, message: 'The Shipper profile is not in a state that allows this action' },
  DRIVER_PROFILE_LOCKED: { status: 409, message: 'This part of the Shipper profile can no longer be changed here' },
  DRIVER_PROFILE_INCOMPLETE: { status: 409, message: 'The Shipper profile is missing required information' },
  BANK_HOLDER_MISMATCH: { status: 400, message: 'The bank account holder must match the Shipper name' },
  DRIVER_BANK_NOT_VERIFIED: { status: 409, message: 'The bank account has not been verified' },
  DRIVER_FUNDING_REQUIRED: { status: 409, message: 'The Shipper needs the initial funding before the profile can be approved' },
  DRIVER_NOT_ACTIVE: { status: 409, message: 'The Shipper is not active' },
  DRIVER_WALLET_NOT_READY: { status: 409, message: 'The wallet does not meet the conditions to take orders' },
  DRIVER_LOCATION_NOT_READY: { status: 409, message: 'The Shipper has no current position to take orders with' },
  DRIVER_HAS_ACTIVE_WORK: { status: 409, message: 'The Shipper still has deliveries in progress' },
  DRIVER_WALLET_NOT_SETTLED: { status: 409, message: 'The wallet balance must be settled first' },
  DRIVER_SELF_ACTION_FORBIDDEN: { status: 403, message: 'An administrator cannot perform this action on their own Shipper profile' },
  // Finance access and the receiving accounts of the system (M04-B2.2a). Same rule: fixed messages that echo nothing the client sent and reveal nothing
  // about another account. ADMIN_FORBIDDEN (above) is the answer to an administrator without the right.
  // M12-C: SYSTEM manages the administrators (permissions, lock, sessions).
  ADMIN_ACCESS_NOT_FOUND: { status: 404, message: 'The administrator account to manage was not found' },
  ADMIN_ACCESS_VERSION_CONFLICT: { status: 409, message: 'The administrator was changed by another request' },
  ADMIN_ACCESS_STATE_CONFLICT: { status: 409, message: 'The administrator is not in a state that allows this action' },
  // M12-E: report exports.
  REPORT_EXPORT_LIMIT: { status: 409, message: 'Too many report exports are already waiting or running' },
  REPORT_EXPORT_NOT_FOUND: { status: 404, message: 'The report export was not found' },
  REPORT_EXPORT_NOT_READY: { status: 409, message: 'The report export is not finished or did not succeed' },
  REPORT_EXPORT_EXPIRED: { status: 409, message: 'The report export file has expired' },
  // M12-F: restore requests (the application records the request; an operator restores).
  BACKUP_RUN_OPEN: { status: 409, message: 'A backup is already queued or running' },
  RESTORE_BACKUP_NOT_FOUND: { status: 404, message: 'The backup to restore from was not found' },
  RESTORE_BACKUP_NOT_USABLE: { status: 409, message: 'Only a finished, encrypted and verified backup can be restored' },
  RESTORE_REQUEST_OPEN: { status: 409, message: 'A restore request is already open' },
  RESTORE_REQUEST_NOT_FOUND: { status: 404, message: 'The restore request was not found' },
  RESTORE_REQUEST_STATE_CONFLICT: { status: 409, message: 'The restore request was changed or can no longer be cancelled' },
  FINANCE_ADMIN_NOT_FOUND: { status: 404, message: 'The administrator was not found' },
  FINANCE_GRANT_STATE_CONFLICT: { status: 409, message: 'The finance right is not in a state that allows this action' },
  FINANCE_VERSION_CONFLICT: { status: 409, message: 'The finance right was changed by another request' },
  FINANCE_BANK_ACCOUNT_EXISTS: { status: 409, message: 'This receiving account is already configured' },
  FINANCE_BANK_ACCOUNT_NOT_FOUND: { status: 404, message: 'The receiving account was not found' },
  // Administration of top-up requests (M04-B2.2b). Same rule: fixed messages that reveal nothing about the wallet, the Shipper or the bank record of anyone else.
  TOPUP_ACCOUNT_NOT_RECEIVING: { status: 409, message: 'The receiving account cannot record money now' },
  BANK_TRANSACTION_ALREADY_RECORDED: { status: 409, message: 'This bank transaction was already recorded' },
  TOPUP_WALLET_LIMIT_EXCEEDED: { status: 409, message: 'The wallet balance would exceed its limit' },
  FINANCE_BANK_ACCOUNT_STATE_CONFLICT: { status: 409, message: 'The receiving account is already in that state' },
  // Shipper top-up requests (M04-B2.1). Same rule: fixed messages that echo nothing the client sent; a request of another Shipper reads as not found.
  TOPUP_AMOUNT_BELOW_MINIMUM: { status: 400, message: 'The top-up amount is below the current minimum' },
  TOPUP_RECEIVING_ACCOUNT_NOT_CONFIGURED: { status: 409, message: 'No receiving account is available for top-ups yet' },
  TOPUP_REQUEST_NOT_FOUND: { status: 404, message: 'The top-up request was not found' },
  TOPUP_REQUEST_STATE_CONFLICT: { status: 409, message: 'The top-up request is not in a state that allows this action' },
  ORDER_PARAMETER_VERSION_CONFLICT: { status: 409, message: 'The order settings were changed by another request' },
  WALLET_PARAMETER_VERSION_CONFLICT: { status: 409, message: 'The wallet parameters were changed by another request' },
  // Withdrawals (M04-C). Same rule: fixed messages that echo nothing the client sent; a withdrawal of another Shipper reads as not found.
  WITHDRAWAL_AMOUNT_BELOW_MINIMUM: { status: 400, message: 'The withdrawal amount is below the current minimum' },
  WITHDRAWAL_INSUFFICIENT_AVAILABLE: { status: 409, message: 'The available balance is not enough for this withdrawal' },
  WITHDRAWAL_BANK_NOT_VERIFIED: { status: 409, message: 'A verified bank account is needed to withdraw' },
  WITHDRAWAL_NOT_FOUND: { status: 404, message: 'The withdrawal was not found' },
  WITHDRAWAL_STATE_CONFLICT: { status: 409, message: 'The withdrawal is not in a state that allows this action' },
  BANK_SNAPSHOT_STALE: { status: 409, message: 'The bank account changed since the withdrawal was requested' },
  WITHDRAWAL_NOT_OWNER: { status: 403, message: 'Only the administrator who took this withdrawal can confirm it' },
  WITHDRAWAL_EVIDENCE_MISMATCH: { status: 409, message: 'The transfer evidence does not match the withdrawal; report it for reconciliation' },
  COMMISSION_POLICY_VERSION_CONFLICT: { status: 409, message: 'The commission policy was changed by another request' },

  // M06-A shipping fee policy (Administration web).
  SHIPPING_POLICY_INVALID: { status: 400, message: 'The shipping fee table is not valid' },
  SHIPPING_DRAFT_VERSION_CONFLICT: { status: 409, message: 'The shipping fee draft was changed by another request' },
  SHIPPING_DRAFT_EMPTY: { status: 409, message: 'There is no saved draft to apply' },
  SHIPPING_POLICY_UNCHANGED: { status: 409, message: 'The draft is identical to the shipping fee table in force' },
  SHIPPING_ELIGIBILITY_VERSION_CONFLICT: { status: 409, message: 'The eligibility parameters were changed by another request' },

  // Delivery flow (M07). Fixed messages: they echo nothing the client sent. A delivery of another shop and a missing one answer the same
  // DELIVERY_NOT_FOUND. VERSION_CONFLICT, SHOP_NOT_FOUND, SHOP_PROFILE_INCOMPLETE and the DRIVER_* codes (above) are reused unchanged.
  // Notifications (M08). A notification of another account and a missing one answer the same.
  NOTIFICATION_NOT_FOUND: { status: 404, message: 'The notification was not found' },

  // Operations (M13). Fixed messages; none echoes what the caller sent. An incident outside the caller's scope answers like a missing one.
  OPS_INCIDENT_NOT_FOUND: { status: 404, message: 'The incident was not found' },
  OPS_INCIDENT_STATE_CONFLICT: { status: 409, message: 'The incident is not in a state that allows this action' },
  OPS_SETTINGS_INVALID: { status: 400, message: 'The operations settings are not valid' },
  OPS_WEBHOOK_INVALID: { status: 400, message: 'The Discord webhook is not valid' },
  OPS_SECRET_UNAVAILABLE: { status: 503, message: 'Secrets cannot be stored on this server' },
  OPS_MAINTENANCE_INVALID: { status: 400, message: 'The maintenance window is not valid' },
  OPS_MAINTENANCE_NOT_FOUND: { status: 404, message: 'The maintenance window was not found' },
  OPS_RELEASE_NOT_FOUND: { status: 404, message: 'The release was not found' },
  OPS_RELEASE_CONFLICT: { status: 409, message: 'The release already exists or is not in a state that allows this action' },
  OPS_RELEASE_WITHDRAW_BLOCKED: { status: 409, message: 'Withdrawing this release would leave no downloadable build that meets the minimum the backend requires' },
  OPS_ARTIFACT_INVALID: { status: 400, message: 'The release file is not valid' },
  OPS_ARTIFACT_UNAVAILABLE: { status: 503, message: 'Release files are not available on this server' },
  OPS_INGEST_UNAUTHORIZED: { status: 401, message: 'The reporting credential is not valid' },
  OPS_DEPLOY_NOT_FOUND: { status: 404, message: 'The deployment was not found' },
  OPS_DEPLOY_STATE_CONFLICT: { status: 409, message: 'The deployment is not in a state that allows this report' },
  OPS_TARGET_NOT_FOUND: { status: 404, message: 'The target was not found' },
  OPS_UPDATE_NOT_READY: { status: 409, message: 'The device must finish its current work before it can update' },
  OPS_DISCORD_NOT_CONFIGURED: { status: 409, message: 'The Discord channel is not configured' },
  DELIVERY_NOT_FOUND: { status: 404, message: 'The delivery was not found' },
  DELIVERY_STATE_CONFLICT: { status: 409, message: 'The delivery is not in a state that allows this action' },
  DELIVERY_ALREADY_TAKEN: { status: 409, message: 'Another Shipper already took this delivery' },
  DELIVERY_SEARCH_EXPIRED: { status: 409, message: 'The search for a Shipper has ended' },
  DELIVERY_NOT_ELIGIBLE: { status: 409, message: 'The Shipper does not meet the conditions to take this delivery' },
  DELIVERY_INPUT_INVALID: { status: 400, message: 'The delivery details are not valid' },
  AFTER_PICKUP_NO_CANCEL: { status: 409, message: 'The goods were picked up, so the delivery can no longer be cancelled' },
  FEE_NOT_CONFIRMED: { status: 409, message: 'The delivery fee is not confirmed yet' },
  FEE_LOCKED: { status: 409, message: 'The delivery fee is fixed' },
  CANCEL_NOT_ALLOWED: { status: 403, message: 'Only the person who created the request can cancel it after the goods were picked up' },
  SHIPPER_FAIL_NOT_ALLOWED: { status: 403, message: 'A Shipper cannot report a failed delivery; contact the shop' },
  FEE_ANSWER_EXPIRED: { status: 409, message: 'The time to answer the proposed delivery fee has run out; the earlier fee stays' },
  FEE_REQUIRED: { status: 400, message: 'The delivery fee must be chosen or proposed to call a Shipper' },
  DESTINATION_NOT_CONFIRMED: { status: 409, message: 'The drop-off point is not confirmed yet' },
  RECALL_BLOCKED_GOODS_OUT: { status: 409, message: 'The goods are not back at the shop, so the delivery cannot be requested again' },
  ADMIN_ACTION_NOT_ALLOWED: { status: 409, message: 'This action does not apply to the delivery in its current state' },

  // Food orders (M10). Fixed messages that echo nothing the client sent. An Order of another account or shop and a missing one answer the same
  // ORDER_NOT_FOUND. VERSION_CONFLICT, SHOP_NOT_FOUND, SHOP_DISABLED, ROLE_NOT_AVAILABLE, AFTER_PICKUP_NO_CANCEL, RECALL_BLOCKED_GOODS_OUT and the
  // DELIVERY_* / ADMIN_* codes (above) are reused unchanged.
  ORDER_NOT_FOUND: { status: 404, message: 'The order was not found' },
  ORDER_STATE_CONFLICT: { status: 409, message: 'The order is not in a state that allows this action' },
  // #191, the order chat. A room the caller may not see answers like a missing order / delivery (ORDER_NOT_FOUND / DELIVERY_NOT_FOUND).
  ORDER_CHAT_CLOSED: { status: 409, message: 'The order has ended; the conversation can only be read' },
  ORDER_CHAT_NOT_PARTICIPANT: { status: 409, message: 'You can no longer write in this conversation' },
  ORDER_CHAT_RATE_LIMITED: { status: 429, message: 'Too many messages; try again in a moment' },
  ORDER_CART_CHANGED: { status: 409, message: 'A dish or a price changed; check the cart and send the order again' },
  ORDER_SHOP_NOT_OPEN: { status: 409, message: 'The shop cannot take this order now' },
  ORDER_SCHEDULE_INVALID: { status: 409, message: 'The wanted time is not possible for this shop' },
  ORDER_ADDRESS_INVALID: { status: 409, message: 'The delivery address is not available' },
  ORDER_EMPTY: { status: 409, message: 'An order without dishes cannot be confirmed' },
  ORDER_CHANGE_REASON_REQUIRED: { status: 409, message: 'The order was changed: a reason is required to confirm it' },
  ORDER_PAYMENT_LOCKED: { status: 409, message: 'The paid amount cannot change while a delivery is in progress' },
  ORDER_PAYMENT_INVALID: { status: 400, message: 'The paid amount is not valid' },
  ORDER_CART_OTHER_SHOP: { status: 409, message: 'The cart holds dishes of another shop' },
  ORDER_INPUT_INVALID: { status: 400, message: 'The order details are not valid' },

  // Shop management (M02-A, task section 7). Same rule: fixed messages that echo nothing the client sent and reveal
  // nothing about any other account. SESSION_*, ACCOUNT_DISABLED, INVALID_SERVICE_AREA, SHOP_PROFILE_INCOMPLETE and
  // VERSION_CONFLICT (above) are reused unchanged.
  SHOP_NOT_FOUND: { status: 404, message: 'No shop was found for this account' },
  SHOP_ROLE_REQUIRED: { status: 403, message: 'The shop role is required for this request' },
  SHOP_DISABLED: { status: 403, message: 'The shop is disabled' },
  SHOP_HAS_OPEN_WORK: { status: 409, message: 'The shop still has orders or deliveries that are not finished' },
  SHOP_STATE_CONFLICT: { status: 409, message: 'The shop is not in a state that allows this action' },
  INVALID_BUSINESS_HOURS: { status: 400, message: 'The business hours are not valid' },

  // Menu (M02-MON). Same rule: fixed messages that echo nothing the client sent. A dish or picture of another shop is never told
  // apart from one that does not exist. VERSION_CONFLICT, SHOP_NOT_FOUND, SHOP_DISABLED and SHOP_PROFILE_INCOMPLETE are reused.
  MENU_ITEM_NOT_FOUND: { status: 404, message: 'The dish was not found' },
  MENU_CATEGORY_NOT_AVAILABLE: { status: 400, message: 'The dish group cannot be chosen' },
  INVALID_SHOP_LOGO: { status: 400, message: 'The shop logo is not valid' },
  SHOP_LOGO_TOO_LARGE: { status: 413, message: 'The shop logo exceeds 1 MiB' },
  INVALID_MENU_IMAGE: { status: 400, message: 'The picture is not valid' },
  MENU_LIMIT_REACHED: { status: 409, message: 'The menu limit of this shop was reached' },
  MENU_IMAGE_NOT_FOUND: { status: 404, message: 'The picture was not found' },
  // Public shop view (M02-XEM): a shop that is not shown to customers, without saying why.
  SHOP_UNAVAILABLE: { status: 403, message: 'The shop is not available' },
  // Dish-group management on the Administration web (M02). Fixed messages: they never echo the name that was sent.
  MENU_CATEGORY_NOT_FOUND: { status: 404, message: 'The dish group was not found' },
  MENU_CATEGORY_NAME_TAKEN: { status: 409, message: 'A dish group with this name already exists' },
  MENU_CATEGORY_NAME_TAKEN_INACTIVE: { status: 409, message: 'An inactive dish group with this name already exists; activate it again instead' },
  MENU_CATEGORY_VERSION_CONFLICT: { status: 409, message: 'The dish group was changed by another request' },

  // Customer address book (M05). Fixed message that echoes nothing the client sent. An address of another account is never told apart
  // from one that does not exist (or was deleted). ROLE_NOT_AVAILABLE, VERSION_CONFLICT and INVALID_PHONE (above) are reused.
  CUSTOMER_ADDRESS_NOT_FOUND: { status: 404, message: 'The address was not found' },

  // Administration web authentication (M01-D-LOGIN). Fixed messages that never echo what the client sent and never
  // say whether an account, a membership or a factor exists. Crypto/storage failures use the generic 503.
  ADMIN_PREAUTH_INVALID: { status: 401, message: 'The authentication step is not valid' },
  ADMIN_TOTP_INVALID: { status: 400, message: 'The authentication code is not valid' },
  ADMIN_AUTH_RATE_LIMITED: { status: 429, message: 'Too many authentication attempts; try again later' },
  ADMIN_CSRF_INVALID: { status: 403, message: 'The request could not be verified' },
  ADMIN_SESSION_INVALID: { status: 401, message: 'The administration session is not valid' },
  ADMIN_ENROLLMENT_NOT_ALLOWED: { status: 409, message: 'Authenticator setup is not available' },

  // ADMIN invitations by the SYSTEM administrator (M01-D-ADMIN-1B, contract section 12). Same rule: fixed messages that
  // echo nothing the client sent (no phone, name, note, reason, token or link) and never say why a step-up failed.
  ADMIN_INPUT_INVALID: { status: 400, message: 'The administration request is not valid' },
  ADMIN_FORBIDDEN: { status: 403, message: 'This administration action is not allowed for this account' },
  ADMIN_STEP_UP_REQUIRED: { status: 403, message: 'A fresh authentication confirmation is required' },
  ADMIN_INVITATION_NOT_FOUND: { status: 404, message: 'The invitation was not found' },
  ADMIN_VERSION_CONFLICT: { status: 409, message: 'The invitation was changed by another request' },
  ADMIN_INVITATION_NOT_PENDING: { status: 409, message: 'The invitation is no longer pending' },
  ADMIN_INVITATION_NOT_REPLAYABLE: { status: 409, message: 'The invitation link can no longer be shown again' },
  ADMIN_INVITATION_PENDING_EXISTS: { status: 409, message: 'A pending invitation already exists for this phone number' },
  ADMIN_PHONE_CONFLICT: { status: 409, message: 'This phone number already belongs to an account' },

  // Administration account reads (M01-ADMIN account read). One answer for an id that does not exist and for one outside the
  // actor's scope, so the id's existence is never revealed.
  USER_NOT_AVAILABLE: { status: 404, message: 'The account is not available' },
  // Lock / unlock of a USER account (M01-ADMIN, D15). Fixed messages: nothing the client sent (reason, id) is echoed.
  USER_ACCOUNT_VERSION_CONFLICT: { status: 409, message: 'The account was changed by another request' },
  USER_ACCOUNT_ALREADY_IN_STATE: { status: 409, message: 'The account is already in the requested state' },
  // The account still has orders or deliveries being processed: it cannot be locked (and so not deleted into a lock) until they finish.
  USER_ACCOUNT_HAS_ACTIVE_WORK: { status: 409, message: 'The account still has orders or deliveries being processed' },
  USER_ACCOUNT_IMPACT_REVIEW_REQUIRED: { status: 409, message: 'This account change is not available until its business impact is reviewed' },

  // SYSTEM settings (Owner decision 2026-10-14). Fixed messages; nothing the client sent is echoed.
  SYSTEM_SETTING_VERSION_CONFLICT: { status: 409, message: 'The settings were changed by another request' },
  // The application side of the OTP switches: registration with no OTP is open (a code is not used) / password reset is closed.
  PHONE_VERIFICATION_NOT_REQUIRED: { status: 409, message: 'Phone verification is not used for this action' },
  PHONE_VERIFICATION_REQUIRED: { status: 409, message: 'Phone verification is required for this action' },
  PASSWORD_RESET_DISABLED: { status: 403, message: 'Self-service password reset is not available' },

  // Administration account activation (M01-D-ADMIN-1C, contract section 16). Same rule: fixed messages that echo nothing
  // the client sent. A bad or closed link is ONE uniform 404 (it never says which). OTP_*, ADMIN_TOTP_INVALID,
  // ADMIN_AUTH_RATE_LIMITED, ADMIN_PHONE_CONFLICT, ADMIN_CSRF_INVALID and ADMIN_INPUT_INVALID (above) are reused.
  ADMIN_ACTIVATION_LINK_INVALID: { status: 404, message: 'The activation link is not valid' },
  ADMIN_ACTIVATION_SESSION_INVALID: { status: 401, message: 'The activation session is not valid' },
  ADMIN_ACTIVATION_STEP_INVALID: { status: 409, message: 'This activation step is not available' },

  // Client registration (M01.03, contract10 section 4 and contract11 sections 5-7). Fixed messages that echo nothing the
  // client sent. CONSENT_VERSION_UNSUPPORTED and AUTH_RESULT_NOT_REPLAYABLE carry the exact messages of the contracts;
  // DEVICE_PROOF_REQUIRED is the one code of the native device-proof family that the local registration needs (a WEB
  // client outside the explicit local mode): the other DEVICE_PROOF_* codes belong to the native binding slice.
  CONSENT_VERSION_UNSUPPORTED: { status: 409, message: 'The consent versions are not supported' },
  AUTH_RESULT_NOT_REPLAYABLE: { status: 409, message: 'The authentication result can no longer be replayed' },
  DEVICE_PROOF_REQUIRED: { status: 403, message: 'A device proof is required for this request' },
  // Native device binding (M01-ANDROID, contract11 section 7). Fixed generic messages: a refusal never says which part of
  // a proof (signature, chain, key, nonce, binding) failed, and public endpoints never disclose a user or a device.
  DEVICE_PROOF_INVALID: { status: 403, message: 'The device proof is not valid' },
  DEVICE_PROOF_EXPIRED: { status: 403, message: 'The device proof has expired' },
  DEVICE_PROOF_UNSUPPORTED: { status: 403, message: 'This device cannot provide the required proof' },
  DEVICE_RATE_LIMITED: { status: 429, message: 'Too many device requests; try again later' },

  // Reviews and complaints (M11). Fixed messages that echo nothing the client sent. A review, order, delivery or complaint of another account is never
  // told apart from one that does not exist. ORDER_MODULE_NOT_READY, DELIVERY_NOT_FOUND, VERSION_CONFLICT and the ADMIN_* codes are reused.
  REVIEW_NOT_ELIGIBLE: { status: 409, message: 'This rating is not available for the order or delivery yet' },
  REVIEW_ALREADY_EXISTS: { status: 409, message: 'This order or delivery was already rated' },
  REVIEW_NOT_FOUND: { status: 404, message: 'The rating was not found' },
  REVIEW_TARGET_NOT_FOUND: { status: 404, message: 'The order or delivery to rate was not found' },
  COMPLAINT_NOT_FOUND: { status: 404, message: 'The complaint was not found' },
  COMPLAINT_TARGET_NOT_FOUND: { status: 404, message: 'The order, delivery or rating of the complaint was not found' },
  COMPLAINT_STATE_CONFLICT: { status: 409, message: 'The complaint is not in a state that allows this action' },
  COMPLAINT_ATTACHMENT_INVALID: { status: 400, message: 'The evidence picture is not valid' },
  COMPLAINT_ATTACHMENT_NOT_FOUND: { status: 404, message: 'The evidence picture was not found' },
  COMPLAINT_ATTACHMENT_LIMIT: { status: 409, message: 'Too many evidence pictures' },
  COMPLAINT_FORBIDDEN: { status: 403, message: 'You cannot do this on this complaint' },
  RECONSIDERATION_EXPIRED: { status: 409, message: 'The period to ask for another review has ended' },
  RECONSIDERATION_NOT_AVAILABLE: { status: 409, message: 'Another review cannot be requested for this complaint' },
  ADJUSTMENT_HISTORY_REVIEW_REQUIRED: { status: 409, message: 'The whole delivery history must be reviewed before this adjustment' },
} as const satisfies Record<string, { status: number; message: string }>;

export type AppErrorCode = keyof typeof APP_ERROR_DEFINITIONS;

export const APP_ERROR_CODES: readonly AppErrorCode[] = Object.freeze(
  Object.keys(APP_ERROR_DEFINITIONS) as AppErrorCode[],
);

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && Object.hasOwn(APP_ERROR_DEFINITIONS, value);
}

/** An error whose public representation is fully defined by the registry. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;

  constructor(code: AppErrorCode) {
    super(APP_ERROR_DEFINITIONS[code].message);
    this.name = 'AppError';
    this.code = code;
    this.status = APP_ERROR_DEFINITIONS[code].status;
  }
}

/**
 * The administration rate-limit refusal. It is the ONLY error that makes the HTTP layer send a Retry-After header, and
 * the header value comes only from this typed field (never from a message, a property of some other exception or the
 * request): a finite integer number of seconds >= 1 that the caller computed from the database clock.
 */
export class AdminAuthRateLimitError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('ADMIN_AUTH_RATE_LIMITED');
    this.name = 'AdminAuthRateLimitError';
    this.retryAfterSeconds =
      Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds >= 1 ? retryAfterSeconds : 1;
  }
}

/**
 * An OTP refusal that carries the safe facts the app needs to react (issue #117): the wrong attempts left, the reason a request was
 * refused (COOLDOWN, PHONE_HOUR, PHONE_DAY, IP_HOUR, GLOBAL_DAY) and when to retry. Only fixed enum strings and integers: never a phone,
 * an address or a code. A refusal with a retry time also sends Retry-After.
 */
export class OtpRefusalError extends AppError {
  readonly details: Readonly<Record<string, string | number>>;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: 'OTP_INVALID' | 'OTP_RATE_LIMITED' | 'OTP_LOCKED', details: Readonly<Record<string, string | number>>, retryAfterSeconds?: number) {
    super(code);
    this.name = 'OtpRefusalError';
    this.details = details;
    this.retryAfterSeconds =
      retryAfterSeconds === undefined ? undefined : Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds >= 1 ? retryAfterSeconds : 1;
  }
}

/** The native device rate-limit refusal; like the administration one it is the typed carrier of a Retry-After value. */
export class DeviceRateLimitedError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('DEVICE_RATE_LIMITED');
    this.name = 'DeviceRateLimitedError';
    this.retryAfterSeconds =
      Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds >= 1 ? retryAfterSeconds : 1;
  }
}

/** The safe, non-sensitive facts a 409 ADMIN_ACTIVATION_STEP_INVALID carries so the client needs no extra call. */
export type ActivationErrorDetails = Readonly<Record<string, string | number | boolean | null | Readonly<Record<string, string | number | boolean | null>>>>;

/**
 * 409 ADMIN_ACTIVATION_STEP_INVALID with the current safe state (contract section 6.4). `details` is built only from
 * values the service computed (enums, booleans, ISO times, counters): never a phone, a name, a token or an id.
 */
export class ActivationStateError extends AppError {
  readonly details: ActivationErrorDetails;

  constructor(details: ActivationErrorDetails) {
    super('ADMIN_ACTIVATION_STEP_INVALID');
    this.name = 'ActivationStateError';
    this.details = details;
  }
}

export type TechnicalErrorKind = 'unavailable' | 'internal';

/**
 * Base class for infrastructure failures (transaction, crypto, JSON validation). They carry a short
 * machine reason for logs and tests, never user data. Over HTTP they all collapse into the generic
 * 503 SERVICE_UNAVAILABLE ("unavailable") or 500 INTERNAL_ERROR ("internal") envelope.
 */
export class TechnicalError extends Error {
  readonly kind: TechnicalErrorKind;

  constructor(kind: TechnicalErrorKind, message: string) {
    super(message);
    this.name = 'TechnicalError';
    this.kind = kind;
  }
}
