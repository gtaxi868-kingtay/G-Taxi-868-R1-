# G868 Launch Checklist (one area)

Agreed 2026-10-18. This page is the finish line.

Rule: until every row below has PASS, nothing new gets built. A failure on
this list gets fixed first. Anything else found along the way goes into
"Later" at the bottom and waits.

How a row passes: a real person does it on a real phone (or the real
website), in the launch area, and someone writes the date and result here.
A code audit or a test in a database does not count as a pass.

Launch area: ______________________ (one community)

## The 10 flows

| # | Flow | Who does it | What "pass" means | Date | Result |
|---|---|---|---|---|---|
| 1 | Rider signs up | A rider | Account made, lands on the home screen | | |
| 2 | Rider books a ride | Same rider | Ride is created, rider sees "searching" | | |
| 3 | Driver gets and accepts the offer | An approved driver | Offer arrives on the driver's phone, accept works | | |
| 4 | Ride happens start to finish | Rider + driver | Arrived, started, completed, with no errors | | |
| 5 | Cash ride settles | Driver | Driver confirms the cash and the ride closes; the split shows correctly in admin | | |
| 6 | Rider cancels a ride | A rider | Ride cancels, the reason picker shows (iPhone too), the driver is told | | |
| 7 | SOS reaches a person | Rider + guardian phone | Guardian phone gets the alert, taps "I'm on it", the rider sees that a guardian has it | | |
| 8 | Shop signs up from the website | A shop owner | /merchant-onboard form submits and HQ sees the shop waiting for approval | | |
| 9 | Shop gets approved and pinned | Admin | Shop goes live and shows on the map | | |
| 10 | Driver gets paid out | Driver + admin | Driver asks for a payout, admin approves it, the money arrives | | |

## Before row 1 can start

- [ ] Phone builds installed from main (rider, driver, merchant, admin)
- [ ] Guardian phone shows NO red "will NOT receive SOS alerts" banner
- [ ] Someone answers 1-868-703-1000, day and night
- [ ] Test accounts (test-fixture-*@example.com) deleted
- [ ] At least one AI backup armed (pay Cerebras or issue a new Gemini key),
      then checked with g_briefing?probe=<provider>

## Later (found while launching, not blocking)

-
