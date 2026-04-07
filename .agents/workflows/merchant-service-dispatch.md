---
description: how to implement the asynchronous merchant-to-rider consent flow
---

## Technical Workflow: Merchant Service Dispatch

This workflow defines the sequence of operations for the "Permission-Based" service vertical.

### Step 1: Rider Appointment Request
- **App**: Rider App
- **Action**: Create entry in `merchant_appointments` with `ride_intent = true`, `merchant_consent_status = 'pending'`.
- **Constraint**: Do NOT call `create_ride` yet.

### Step 2: Merchant Notification
- **App**: Merchant App
- **Logic**: Use Supabase Realtime to listen for new records in `merchant_appointments`.
- **UI**: Display "G-TAXI PERMISSION REQUEST" alert on the dashboard.

### Step 3: Merchant Permission Grant
- **App**: Merchant App
- **Action**: Merchant clicks "Approve". 
- **DB Update**: Update `merchant_consent_status` to `'granted'`.

### Step 4: Automated Dispatch Trigger
- **Edge Function**: `process_merchant_consent`
- **Trigger**: Database Webhook or manual invocation from Step 3.
- **Action**: Call `create_ride` (Server-side) using the stored pickup coordinates.
- **Pricing**: Apply `merchant_referral` discount factor (5%) to the platform fee.

### Step 5: Rider Confirmation
- **Notification**: Push notification to Rider: "Your ride has been approved and is on the way!"
- **App**: Rider App transitions from "Pending Approval" to "Searching Driver".
