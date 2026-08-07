# Dolphin App 🐬

Dolphin is a modern, high-fidelity mobile application designed for campus communities. Built using React Native with Expo, it provides students and campus members with a centralized hub for social interaction, second-hand marketplace transactions, lost-and-found tracking, and community onboarding.

---

## Key Features

### 1. Community & Feed 📣
- **Post & Share**: Share updates, thoughts, and campus news with images and descriptions.
- **Engage**: Like and comment on posts.
- **Bookmarks**: Save posts or market listings to read or view later, all managed in a centralized "Saved Items" profile section.
- **Hyperlinks**: Auto-detects URLs (like Google Docs, websites, etc.) and highlights them as clickable links that open in the native browser.

### 2. Used Market (Second-hand Trade) 🛒
- **List Items**: Sell used textbooks, electronics, or campus gear with images, description, pricing, and item status.
- **Interactive Listings**: View details, contact sellers directly, and save listings to your favorites.

### 3. Lost & Found 🔍
- **Report & Track**: Report lost or found items on campus with category, location details, and pictures.
- **Filtering**: Search and filter items to quickly match lost belongings with found notices.

### 4. Direct Messaging & Lounge 💬
- **Real-time Chats**: Connect with other students or campus members regarding posts, market items, or lost items.

### 5. Onboarding & Guides 🗺️
- **First-time Tour**: Interactive onboarding flows introducing students to different sections of the app (Market, Community, Lounge, Lost & Found) complete with illustrative guides and instructions.

### 6. User-Generated Content (UGC) Moderation & Safety 🛡️
To ensure a safe environment and comply with App Store policies (Guideline 1.2 & 5.1.1):
- **EULA Agreement**: Zero-tolerance policy checkbox agreement required upon signup/login.
- **Reporting & Flagging**: Easy reporting system for inappropriate posts, listings, or profiles.
- **User Blocking**: Block abusive users to instantly filter out their content from all feeds.
- **Account Deletion**: Clean and secure account deletion mechanism that deletes user profile data from Firestore and removes the authentication account.

---

## Tech Stack

- **Framework**: [Expo](https://expo.dev/) (React Native)
- **Language**: TypeScript
- **Database & Auth**: [Firebase](https://firebase.google.com/) (Auth, Firestore, Cloud Storage)
- **Navigation**: React Navigation (Native Stack & Bottom Tabs)
- **UI & Animation**: React Native Reanimated, Linear Gradient, SVG

---

## Project Structure

```text
dolphin/
├── admin-panel/         # Web or companion dashboard files
├── assets/              # App logos, splash screens, onboarding images
├── docs/                # Project documentation and guides
├── functions/           # Firebase Cloud Functions (if any)
├── src/
│   ├── components/      # Reusable UI components (e.g., HyperlinkText, Cards)
│   ├── config/          # Firebase, Google Auth, and environment setup
│   ├── context/         # React Context providers (Auth, Theme, etc.)
│   ├── lostandfound/    # Domain-specific components for Lost & Found
│   ├── navigation/      # Bottom Tab and Stack Navigators
│   ├── screens/         # Main screens (Community, Market, LostFound, Profile, Settings)
│   ├── theme/           # Color palettes, dark/light theme definitions
│   ├── types/           # TypeScript definitions
│   └── utils/           # Helper functions and moderation hooks
├── App.tsx              # Application entry point
├── app.json             # Expo project configuration
├── eas.json             # Expo Application Services configuration
└── package.json         # Dependency manifest
```

---

## Getting Started

### Prerequisites
- Node.js (v18 or higher recommended)
- npm or yarn
- Expo Go app on your physical device, or an iOS Simulator / Android Emulator

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/songdo-technology/dolphin-app.git
   cd dolphin-app
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Copy the example environment file and fill in your Firebase project configurations:
   ```bash
   cp .env.example .env
   ```
   Open the `.env` file and replace the placeholder values with your Firebase API keys and Google Sign-In Client IDs.

4. **Run the application**:
   ```bash
   npx expo start
   ```
   Scan the QR code with your phone (using Expo Go or Camera app) or press `i` for iOS Simulator or `a` for Android Emulator.

---

## License

This project is private and proprietary. All rights reserved.
