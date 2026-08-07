# G-TAXI PRIVACY POLICY

**Last updated:** 2026-08-05
**Jurisdiction:** Trinidad and Tobago (primary) — scalable to other Caribbean jurisdictions
**Platform:** G-Taxi mobile applications, websites, NFC kiosks, and related services
**Operator:** G-Taxi Technology Ltd. (company registration to be filed, Trinidad and Tobago)

> **Status: DRAFT — requires review by a qualified Trinidad and Tobago attorney
> before publication.** Every fact about what data is collected and which third
> parties receive it was taken from the live system, not assumed. The retention
> periods in section 7 are proposals and are commercial decisions the operator
> must confirm.

---

## 1. WHO WE ARE

G-Taxi Technology Ltd. ("G-Taxi", "we", "us") operates a technology platform
connecting independent drivers, merchants and service providers with clients in
Trinidad and Tobago.

For the purposes of the **Data Protection Act, 2011 (Act 13 of 2011)**, G-Taxi
is the **data controller** for personal information described in this policy.

**Data protection enquiries:** privacy@gtaxi.tt

---

## 2. WHAT WE COLLECT

### 2.1 Everyone who creates an account
- Full name
- Email address
- Phone number
- Password (stored only as a cryptographic hash — we never see it)
- Account role (rider, driver, merchant, commander, admin)
- Device push-notification token, if you enable notifications
- Record of which legal documents you accepted, and when

### 2.2 Riders
- Pickup and drop-off addresses, and their coordinates
- Live location while a ride is being requested or is in progress
- Saved places you choose to store
- Trip history, fares and ratings
- Wallet balance and transaction history
- Payment method tokens (see 2.6 — we do not store card numbers)
- Photographs you upload to your profile
- Optional preferences and, if you enable it, assistant memory

### 2.3 Drivers
- Everything in 2.1, plus:
- Vehicle make, model and registration plate
- Driver's permit, insurance certificate, vehicle registration and PSV badge
  where applicable, including document expiry dates
- Photographs of documents and of the vehicle
- Live location while you are online
- Earnings, payouts and any outstanding balance
- Ratings and completed-trip counts

### 2.4 Merchants and commanders
- Business name, address and coordinates
- Bank or payout details where provided
- Products, pricing, orders and commission records
- Staff accounts you create

### 2.5 G-Escape travel bookings — sensitive
If you book travel through G-Escape we collect, for each traveller:
- Passport number, expiry date and country of issuance
- Date of birth
- Emergency contact details

This is **sensitive personal information**. It is collected only because
airlines, hotels and border authorities require it, is used for no other
purpose, and is subject to the shortest retention period in section 7.

### 2.6 Payments
Card details are entered directly into our payment processors and are **never
stored on G-Taxi systems**. We hold only a processor-issued token and the last
four digits.

### 2.7 Automatically collected
- Device type and operating system
- App version
- Error and crash diagnostics
- Approximate location derived from your connection

---

## 3. WHY WE USE IT

| Purpose | Lawful basis |
|---|---|
| Connect you with a driver, merchant or provider | Performance of a contract |
| Process payments and settle earnings | Performance of a contract |
| Show a driver your pickup point, and you their vehicle | Performance of a contract |
| Verify driver documents and insurance validity | Legal obligation; safety |
| Prevent fraud and investigate incidents | Legitimate interest; safety |
| Provide passport data to airlines and hotels you book | Performance of a contract |
| Send trip and account notifications | Performance of a contract |
| Optional assistant features and suggestions | **Consent** — you may switch this off at any time |
| Improve the service and fix faults | Legitimate interest |

We do **not** sell your personal information.

---

## 4. WHO ELSE SEES IT

### 4.1 Other users, strictly limited
- Your **driver** sees your first name, pickup and drop-off, and your phone
  number only for the duration of an active trip.
- **You** see your driver's first name, photo, vehicle and plate.
- Neither of you can see the other's account, history or contact details once
  the trip ends.
- Merchants see only the details needed to fulfil your order.

### 4.2 Service providers who process data on our behalf

We use the following processors. Each receives only what its function requires.

| Provider | Purpose | Data involved |
|---|---|---|
| Supabase | Database, authentication, file storage | All platform data |
| Stripe | Card payments | Payment tokens, amounts |
| WiPay | Card payments (Trinidad and Tobago) | Payment tokens, amounts |
| Mapbox | Maps, geocoding, routing | Addresses and coordinates |
| Expo | Push notifications | Device token, message content |
| Groq | Optional AI assistant features | Assistant conversation content |
| Google Cloud Vision | Reading uploaded receipts and product photos | The image you upload |
| Sentry | Error diagnostics | Technical error data |
| Upstash | Temporary caching | Non-identifying operational data |

**Some of these providers process data outside Trinidad and Tobago.** Where that
happens we rely on the provider's contractual data-protection commitments.

### 4.3 Airlines, hotels and travel operators
Where you book travel, we pass the traveller details in 2.5 to the specific
airline, hotel or operator for that booking, and to no one else.

### 4.4 Law enforcement and regulators
We disclose information where required by law, court order, or a lawful request
from a regulator such as the Ministry of Works and Transport, and where
necessary to protect someone's safety.

---

## 5. THE AI ASSISTANT

If you use the optional assistant:
- Your message and the context needed to answer it are sent to our AI provider.
- The assistant **cannot spend your money**. It can only prepare a draft that
  you confirm yourself.
- It is given only **your own** data. It is not given other users' information.
- If you switch assistant memory off, the ability to store anything is removed
  before your message is processed, not merely discouraged.
- You can erase everything the assistant has remembered from within the app.

---

## 6. YOUR RIGHTS

Under the Data Protection Act, 2011 you may:
- Ask what personal information we hold about you
- Ask us to correct anything inaccurate
- Ask us to delete your account and data (subject to section 7)
- Withdraw consent for optional features such as the assistant
- Object to processing based on legitimate interest
- Ask for your data in a portable form
- Complain to the Office of the Information Commissioner

To exercise any of these, contact **privacy@gtaxi.tt**. We respond within
**30 days**.

To delete your account, email **privacy@gtaxi.tt** — the in-app button is not
built yet, though everything behind it is. You get a 30-day grace period in which
it can be undone. Some records must be retained; see section 7 and the
[Data Retention and Deletion Notice](DATA_RETENTION_AND_DELETION.md).

---

## 7. HOW LONG WE KEEP IT

> These periods are **proposals pending the operator's confirmation**. Financial
> and safety periods should be checked against Board of Inland Revenue and
> insurance requirements before publication.

| Data | Retained | Why |
|---|---|---|
| Account details | Life of account, then 90 days | Allow account recovery |
| Trip records | 7 years | Tax and dispute records |
| Payment and wallet records | 7 years | Financial records law |
| Driver documents (licence, insurance) | Life of account + 7 years | Regulatory and insurance evidence |
| **Passport and traveller details** | **90 days after travel completes** | Shortest period the booking allows |
| Live location | 90 days | Safety investigations and disputes |
| Assistant memory | Until you erase it, or account deletion | It is yours |
| Support messages | 3 years | Dispute history |
| Consent records | 7 years after account closes | Proof of what you agreed to |

After an account is deleted, remaining records are stripped of identifying
details wherever the law allows them to be.

---

## 8. HOW WE PROTECT IT

- All traffic is encrypted in transit.
- Access is enforced at the database itself, per user — not merely hidden in the
  app. A rider's account cannot read another rider's records.
- Identity documents and receipts are held in **private** storage. Links are
  time-limited and individually issued.
- Payment card numbers never reach our systems.
- Staff access is limited by role and is logged.

No system is perfectly secure. If a breach affects your personal information we
will notify you and the Office of the Information Commissioner without undue
delay.

---

## 9. CHILDREN

The platform is not for anyone under 18. We do not knowingly collect children's
information. If you believe a child has registered, contact privacy@gtaxi.tt and
we will remove the account.

---

## 10. CHANGES

If we make a material change we will notify you in the app and ask you to accept
the new version. Your acceptance of each version is recorded, and earlier
versions remain on record.

---

## 11. CONTACT

**G-Taxi Technology Ltd.**
Data protection: privacy@gtaxi.tt
General support: support@gtaxi.tt
Legal notices: legal@gtaxi.tt
WhatsApp: +1 868 703 1000

You may also complain to the **Office of the Information Commissioner,
Trinidad and Tobago**.
