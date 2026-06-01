# App Store Compliance Checklist
Use this to verify readiness before submitting to the App Store / Google Play.

## Prerequisites
- [ ] All critical security holes are fixed (Phase 1-3, 7)
- [ ] Stripe payment integration is complete (Phase 6)
- [ ] Crash-free rate is >99.5% on test devices
- [ ] Edge functions have `verify_jwt: true` where applicable
- [ ] No service role key in client bundles

## Account & Onboarding
- [ ] App Store Connect account created (Apple)
- [ ] Google Play Developer account created ($25 one-time)
- [ ] App name checked for availability in both stores
- [ ] Privacy policy URL hosted and accessible
- [ ] Terms of Service URL hosted and accessible
- [ ] Support email address configured
- [ ] Test/review accounts created (rider, driver, admin)
- [ ] Demo mode or special flows for test users

## Technical Requirements

### Rider App (apps/rider)
- [ ] EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY set in EAS Secrets
- [ ] EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN set
- [ ] EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY set
- [ ] EXPO_PUBLIC_SENTRY_DSN set
- [ ] iOS bundle ID = com.gtaxi.rider
- [ ] Android package name = com.gtaxi.rider
- [ ] GoogleService-Info.plist matches iOS bundle ID
- [ ] google-services.json matches Android package name
- [ ] App icon and splash screen configured
- [ ] Privacy manifest (iOS) — required for API usage
- [ ] Data Safety section (Google Play) filled in

### Driver App (apps/driver)
- [ ] Firebase configs regenerated with correct IDs:
  - [ ] google-services.json package_name = com.gtaxi.driver
  - [ ] GoogleService-Info.plist BUNDLE_ID = com.gtaxi.driver
- [ ] Expo push notifications configured (FCM credentials in Expo dashboard)
- [ ] Background location permission configured (iOS Info.plist)
- [ ] Background location justification string (iOS) — required by App Store

### Admin App (apps/admin)
- [ ] Auth gate added (currently a public webpage — CRITICAL)
- [ ] No service role key in bundle
- [ ] Admin credentials documented for reviewer

## Legal & Privacy
- [ ] Privacy policy covers:
  - [ ] What data is collected (location, payment info, contacts, photos)
  - [ ] How data is used (ride matching, payments, support)
  - [ ] Third-party sharing (Mapbox, Stripe, Sentry)
  - [ ] Data retention and deletion policy
  - [ ] Children's privacy (COPPA compliance)
- [ ] Terms of Service covers:
  - [ ] User responsibilities
  - [ ] Liability limitations
  - [ ] Payment terms
  - [ ] Cancellation policy
  - [ ] Dispute resolution

## Testing & Review
- [ ] Rider onboarding flow works end-to-end
- [ ] Driver onboarding flow works end-to-end (documents, background check)
- [ ] Ride request → match → pickup → dropoff → payment flow works
- [ ] Offline/online state machine works
- [ ] Push notifications arrive on both platforms
- [ ] Location permissions granted / denied
- [ ] Camera permissions for profile photo
- [ ] Notifications permission prompt
- [ ] Rate limiting doesn't block legitimate users
- [ ] Test with slow network (LTE throttling)
- [ ] Test with no network (offline state)
- [ ] Review account credentials documented for Apple/Google reviewer

## Store Listings
- [ ] Screenshots (iPhone 6.5" + 5.5", iPad, Android 7" + 10" tablets)
- [ ] App description (short + full)
- [ ] Keywords / Search terms
- [ ] Category selected (Travel, Navigation, Utilities)
- [ ] Content rating questionnaire completed
- [ ] Age rating set
- [ ] Pricing and availability set (free, in-app purchases)

## Post-Submission
- [ ] Export Compliance (iOS) — does the app use encryption? (Stripe SDK uses HTTPS/TLS)
- [ ] TestFlight build distributed to internal testers (iOS)
- [ ] Closed track/alpha track created (Android)
- [ ] Crash reporting verified (Sentry events received)
- [ ] Monitoring dashboards set up (Supabase logs, Sentry)
