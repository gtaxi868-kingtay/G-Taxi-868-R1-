# G-TAXI DATA RETENTION AND DELETION NOTICE

**Last updated:** 2026-08-05
**Jurisdiction:** Trinidad and Tobago (primary) — scalable to other Caribbean jurisdictions
**Platform:** G-Taxi mobile applications, websites, NFC kiosks, and related services
**Operator:** G-Taxi Technology Ltd. (company registration to be filed, Trinidad and Tobago)

> **Status: DRAFT — requires review by a qualified Trinidad and Tobago attorney
> before publication.** Every period in section 3 is a **proposal**. The 7-year
> financial periods should be confirmed against Board of Inland Revenue
> requirements, and the driver-document periods against insurance and Ministry of
> Works and Transport practice. **None of these schedules is automated in the
> software yet** — see section 7, which states plainly what is and is not built.

This notice supplements the [Privacy Policy](PRIVACY_POLICY.md) and gives the
detail that the **Data Protection Act, 2011 (Act 13 of 2011)** expects: what we
keep, for how long, and why.

---

## 1. THE PRINCIPLE

We keep personal information only as long as we have a reason to. The reasons
are:

1. **You still have an account** and we need the data to run it.
2. **The law requires it** — tax, financial and transport records.
3. **A dispute or investigation is open** and the record is evidence.
4. **Safety** — an incident record that may matter later.

When none of those apply, the data is deleted or stripped of anything that
identifies you.

---

## 2. HOW WE DELETE

Two different things happen, and the difference matters:

**Deletion** — the record is removed.

**Anonymisation** — the record stays, but everything identifying you is
permanently removed: name, email, phone, exact addresses, and the link to your
account. What remains is a fare figure and a date, which cannot be traced back to
you. We use this for trip and financial records we are legally required to keep
in aggregate.

Deleted data disappears from backups within **30 days**, as backups roll over.

---

## 3. THE SCHEDULE

### 3.1 Account
| Data | Kept for | Reason |
|---|---|---|
| Name, email, phone | Life of account + 90 days | Recover an accidental deletion |
| Password hash | Life of account | Sign-in |
| Push token | Life of account, or until you disable notifications | Sending you alerts |
| Consent records | 7 years after account closes | Proof of what you agreed to, and when |

### 3.2 Trips and orders
| Data | Kept for | Reason |
|---|---|---|
| Trip record, fare, date | 7 years, **anonymised after account closes** | Tax and financial records |
| Pickup and drop-off addresses | 12 months, then removed from the trip record | Beyond this we have no reason to hold where you go |
| Live location trace | 90 days | Safety investigations and fare disputes |
| Ratings and comments | 24 months | Identifying repeat safety problems |
| Order contents | 24 months | Dispute history |

### 3.3 Money
| Data | Kept for | Reason |
|---|---|---|
| Wallet transactions | 7 years | Financial records law |
| Payment tokens | Until you remove the payment method | Repeat payments |
| Payout records | 7 years | Tax |
| Refund and dispute records | 7 years | Evidence |

**Financial records cannot be deleted on request.** This is the one category
where the law overrides your deletion request, and it applies to every business,
not only ours.

### 3.4 Drivers and operators
| Data | Kept for | Reason |
|---|---|---|
| Driver's permit, insurance, registration | Life of account + 7 years | Regulatory and insurance evidence |
| Compliance review decisions | 7 years | Proof we checked |
| Vehicle details | Life of account + 7 years | Incident traceability |
| Earnings records | 7 years | Tax |

### 3.5 Merchants
| Data | Kept for | Reason |
|---|---|---|
| Business details | Life of account + 7 years | Commercial and tax records |
| Product catalogue | Life of account | Running the store |
| Commission and settlement records | 7 years | Tax |

### 3.6 Travel — the shortest period we hold
| Data | Kept for | Reason |
|---|---|---|
| **Passport number, expiry, country** | **90 days after travel completes** | Required by the airline and border authority, and for nothing else |
| **Date of birth** | **90 days after travel completes** | Same |
| **Emergency contact** | **90 days after travel completes** | Same |
| Booking record (no passport data) | 7 years, anonymised after account closes | Financial record |

This is the most sensitive data on the platform and it has the shortest life.
That is deliberate.

### 3.7 Assistant and support
| Data | Kept for | Reason |
|---|---|---|
| Assistant memory | Until you erase it, or account deletion | It is yours; erase it any time in the app |
| Assistant conversations | 90 days | Fixing faults |
| Support messages | 3 years | Dispute history |

### 3.8 Technical
| Data | Kept for | Reason |
|---|---|---|
| Error and crash diagnostics | 90 days | Fixing faults |
| Security and access logs | 12 months | Investigating misuse |
| Admin action audit log | 7 years | Accountability for staff decisions |

---

## 4. DELETING YOUR ACCOUNT

### 4.1 How
In the app: **Profile → Account → Delete account**.
Or email **privacy@gtaxi.tt** from your registered address.

### 4.2 What happens
1. We confirm it is really you.
2. Your account is deactivated immediately — you can no longer sign in.
3. For **30 days** it can be restored if you change your mind.
4. After 30 days, everything not held under section 3 is deleted, and the
   records we must keep are anonymised.

### 4.3 What we cannot delete
- Financial and tax records (section 3.3)
- Driver regulatory records (section 3.4)
- Records that are evidence in an open dispute, safety investigation, or legal
  claim — kept until it closes, then handled under the normal schedule
- Records a court or authority has ordered us to preserve

We will tell you specifically which of these applies to you.

### 4.4 Before you delete
- **Withdraw your wallet balance.** We cannot return it after deletion, and we
  cannot leave a balance sitting under a deleted account.
- **Drivers:** settle anything owed. Your earnings are yours; the platform's
  share of cash jobs is not.
- Download any receipts you want to keep.

### 4.5 Deleting only some things
You do not have to delete everything. In the app you can separately:
- Erase everything the assistant remembers
- Remove a saved payment method
- Delete saved places
- Turn off notifications
- Turn off assistant memory entirely

---

## 5. YOUR RIGHTS

Under the Data Protection Act, 2011 you may ask for a copy of what we hold, ask
us to correct it, ask us to delete it, or object to how we use it.

Write to **privacy@gtaxi.tt**. We respond within **30 days**. If we refuse
something, we tell you which exemption applies and why.

You may complain to the **Office of the Information Commissioner, Trinidad and
Tobago**.

---

## 6. WHERE THE DATA LIVES

Platform data is held with Supabase. Payment processing involves Stripe and
WiPay. Some processing happens outside Trinidad and Tobago. The full list of
processors is in section 4.2 of the [Privacy Policy](PRIVACY_POLICY.md).

---

## 7. WHAT IS AND IS NOT AUTOMATED — HONEST STATEMENT

We would rather say this plainly than imply more than is true.

**Built and working today:**
- **The schedules in section 3 run automatically**, every night at 03:15. A
  single sweep covers passport data, booking passenger details, trip addresses,
  GPS breadcrumbs, safety-point identities, in-trip chat, incident detail, push
  receipts, delivered reminders, admin IP addresses, and closed accounts.
- **Every run is audited** — category, action taken, number of records, and
  timestamp. A purge with no record of itself is indistinguishable from data
  loss, so we keep the record.
- **The schedule is data, not code.** Each period in section 3 is a row an
  administrator can read and change, and any category can be switched off
  instantly.
- **Legal holds are honoured.** Records attached to an unresolved safety
  incident or an open dispute are never purged on schedule, and an account
  deletion in that situation is paused rather than completed. You are told when
  this happens.
- **Anonymisation preserves what the law requires.** Deleting an account
  destroys your identity but keeps the financial record — the alternative would
  break a seven-year trail we are obliged to hold.
- Consent records — every acceptance of every document version is stored, with a
  timestamp, and cannot be altered by the user or by staff.
- Assistant memory erasure — a real, working control in the app.
- Access control — enforced by the database on every query, per user.
- Private storage for identity documents and receipts, with time-limited links.

- **Account deletion is in the app**, under Settings → Your account. It asks you
  to type DELETE, warns you if you still have money in your wallet, and then
  gives you 30 days in which one tap cancels the whole thing. Your account keeps
  working normally during those 30 days — being locked out of the screen holding
  your own cancel button would make the grace period meaningless.
- **Files you uploaded are queued for deletion** when your account closes, and
  removed from storage. Driver licences and insurance certificates are the
  exception: those are kept as regulatory evidence under section 3.4.

- **File deletion is automatic**, nightly, and has been tested end to end
  against live storage. Files you uploaded are removed; driver licences and
  insurance certificates are refused by that same job, because section 3.4
  requires us to keep them.

**Not yet complete:**
- Profile photos are held in a bucket that serves them by direct link, so your
  driver can see your photo at pickup. The link is unguessable and only ever
  given to someone already permitted to see your profile, but it is not
  individually time-limited the way identity documents and receipts are.

---

## 8. CONTACT

**G-Taxi Technology Ltd.**
Data protection: privacy@gtaxi.tt
Support: support@gtaxi.tt
Legal notices: legal@gtaxi.tt
WhatsApp: +1 868 703 1000
