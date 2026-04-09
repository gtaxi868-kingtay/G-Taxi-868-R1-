# G-Taxi Production Logistics Setup Guide

This guide provides the exact steps to activate the dormant SMS (Twilio) and Monitoring (Sentry) layers on your new production account.

## 1. Monitoring Setup (Sentry)
I have successfully applied your DSNs to both the **Rider** (...5341186048) and **Driver** (...05800448) environments.

**Status:**
- [x] Rider DSN Aligned
- [x] Driver DSN Aligned

### **Click-by-Click: Creating the Driver Project**
1. **Login**: Go to [Sentry.io](https://sentry.io).
2. **Projects Tab**: On the far left sidebar, click the **"Projects"** icon (looks like a folder/briefcase).
3. **Double Check Org**: In the top-left corner, ensure it says **"gtaxi-868-ltd"**. If you see a different name, click it to switch.
4. **Create Project**: Look for the blue **"Create Project"** button in the top right.
5. **Select Platform**:
   - In the "Search Platforms" box, type **"React Native"**.
   - Click the **React Native** icon.
6. **Name Your Project**:
   - In the "Project Name" box at the bottom, type: `gtaxi-driver`.
7. **Create**: Click the big **"Create Project"** button.
   - *Note: Sentry might show you a "Configure SDK" page. You can ignore the code it shows you (I've already written it).*
8. **Get the DSN**:
   - Click **"Settings"** in the top right (or on the left sidebar).
   - Under the "Project" section, click **"Client Keys (DSN)"**.
   - **Copy the DSN.**

### **Injection Command:**
Once you have the DSN, run this in your terminal:
```bash
cd apps/driver
eas env:create preview --name EXPO_PUBLIC_SENTRY_DSN --value "YOUR_NEW_DSN" --visibility plaintext --non-interactive
```

> [!TIP]
> If you still don't see the project on your Dashboard after creating it, look for the "All Projects" dropdown in the top navigation bar—it sometimes defaults to a single project view.

---

## 2. SMS Setup (Twilio)
You asked about Firebase for SMS. **Firebase Cloud Messaging (FCM)** is used for internal push notifications (Rider matched, Ride arrived). However, FCM cannot send a text message to a guest's phone number. For the **Merchant Concierge** flow (summoning a ride for someone without the app), you MUST use an SMS provider like Twilio.

**Steps:**
1. Register at [Twilio.com](https://twilio.com).
2. Buy a phone number with SMS capabilities.
3. Get your **Account SID**, **Auth Token**, and **Twilio Number**.
4. Run these commands locally to push the secrets to your Supabase Cloud:
```bash
# Push secrets to Supabase production
npx supabase secrets set --project-ref ffbbuafgeypvkpcuvdnv \
  TWILIO_ACCOUNT_SID="AC..." \
  TWILIO_AUTH_TOKEN="your_token" \
  TWILIO_PHONE_NUMBER="+1..."
```

---

## 3. Verification
* **Sentry**: Once set, the next EAS build will automatically "bake" these DSNs into the app.
* **Active Production Builds (Track Progress):**
  - **Rider**: [Build Log](https://expo.dev/accounts/gtaxi/projects/g-taxi-rider/builds/d4a9bba6-964d-4615-8011-e7ea09961814)
  - **Driver**: [Build Log](https://expo.dev/accounts/gtaxi/projects/gtaxi-driver/builds/8928e862-c7e3-4592-bb83-9777f8a658a6)
* **SMS**: You can test the SMS immediately after setting the secrets by triggering a Guest Summon from the Merchant app.

> [!IMPORTANT]
> Always use the `--project-ref` flag for Supabase to ensure you are targeting the cloud instance and not a local dev container.
