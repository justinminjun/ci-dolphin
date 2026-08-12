# 🐬 Dolphin App - 프로젝트 핸드오프 문서

> **이 문서를 Claude에 그대로 붙여넣으면 프로젝트 컨텍스트를 즉시 이어받을 수 있습니다.**

---

## 📋 프로젝트 개요

- **앱 이름**: Dolphin (돌핀)
- **용도**: Chadwick International School (인천 송도) 학교 커뮤니티 앱
- **플랫폼**: iOS (주력), Android (보조)
- **프로젝트 경로**: `/Users/junyoung/OPENCLAW/dolphin`
- **번들 ID**: `com.chadwick.dolphin`
- **현재 버전**: 1.3.0 (빌드 44)
- **App Store Connect**: https://appstoreconnect.apple.com/apps/6763223607/testflight/ios
- **EAS Project ID**: `5fd2bbef-db4b-4a84-b778-2a057dad9bcf`

---

## 🛠️ 기술 스택

| 항목 | 기술 |
|------|------|
| Framework | React Native (Expo SDK 54, `expo@~54.0.34`) |
| React | 19.1.0 |
| RN | 0.81.5 |
| Language | TypeScript 5.9 |
| Navigation | React Navigation 7 (Bottom Tabs + Native Stack) |
| Backend | Firebase (Firestore, Auth, Storage, Cloud Functions) |
| Firebase Project | `lost-and-found-20c10` |
| Maps | `react-native-maps` 1.20.1 (Google Maps Provider, API Key: `AIzaSyAZ_rgZ36eUlfppXajOITzxLAmLmfllkMQ`) |
| Auth | Google Sign-In (`@react-native-google-signin/google-signin`) |
| AI | Google Generative AI (`@google/generative-ai`) - Gemini API |
| Build | EAS Build (`eas-cli`), 로컬 빌드도 가능 |
| Theme | 커스텀 theme 시스템 (`src/theme/theme.ts`) |

---

## 📁 프로젝트 구조

```
dolphin/
├── App.tsx                    # 앱 진입점, AuthProvider, GlowProvider, NavigationContainer
├── index.ts                   # registerRootComponent
├── app.json                   # Expo 설정 (버전, 플러그인, API 키)
├── eas.json                   # EAS Build/Submit 설정
├── firebase.json              # Firebase 배포 설정
├── firestore.rules            # Firestore 보안 규칙
├── storage.rules              # Storage 보안 규칙
├── package.json               # 의존성
│
├── src/
│   ├── config/
│   │   ├── firebase.ts        # Firebase 초기화 (db, auth, storage export)
│   │   └── AuthContext.tsx     # Auth state 관리 (isStudent, user 등)
│   │
│   ├── navigation/
│   │   ├── AppNavigator.tsx    # Stack Navigator (Login, Main, Detail 스크린들)
│   │   └── MainTabs.tsx        # Bottom Tab Navigator (6개 탭)
│   │
│   ├── screens/
│   │   ├── HomeScreen.tsx      # 🏠 홈 - 위젯들 (Calendar, Lunch, AQI, Quick Access)
│   │   ├── CommunityScreen.tsx # 💬 FS Lounge (기존 Lounge + Market 통합)
│   │   ├── LocalMapScreen.tsx  # 🗺️ Local Guide 지도 (72KB, 가장 큰 파일)
│   │   ├── LocalGuideScreen.tsx # Local Guide 상세/추천 작성
│   │   ├── AddRecommendationScreen.tsx # 추천 작성 전용 스크린
│   │   ├── LostFoundScreen.tsx # 🔍 Lost & Found
│   │   ├── ChatListScreen.tsx  # 💌 Messages (DM 목록)
│   │   ├── ChatRoomScreen.tsx  # 개별 채팅방
│   │   ├── ProfileScreen.tsx   # 👤 My Profile
│   │   ├── ProfileSubScreens.tsx # 프로필 하위 화면들
│   │   ├── MarketScreen.tsx    # Market (CommunityScreen 안에 탭으로 통합됨)
│   │   ├── ListingDetailScreen.tsx # 마켓 상품 상세
│   │   ├── CreateListingScreen.tsx # 마켓 등록
│   │   ├── CreatePostScreen.tsx    # 라운지 글 작성
│   │   ├── PostDetailScreen.tsx    # 라운지 글 상세
│   │   ├── LoginScreen.tsx     # Google 로그인
│   │   ├── OnboardingScreen.tsx # 온보딩
│   │   ├── AnimatedSplash.tsx  # 스플래시 애니메이션
│   │   ├── AdminScreen.tsx     # 관리자 패널
│   │   ├── NotificationsScreen.tsx # 알림
│   │   ├── MapPickerScreen.tsx # 위치 선택
│   │   └── tech/               # Tech Support 관련 스크린들
│   │
│   ├── components/
│   │   ├── CalendarWidget.tsx   # 📅 학교 캘린더 위젯 (compact + full modal)
│   │   ├── LunchMenuWidget.tsx  # 🍽️ 점심 메뉴 위젯 (compact + full modal)
│   │   ├── WeatherAQIWidget.tsx # 🌤️ 날씨/AQI 위젯
│   │   ├── LocalGuideCards.tsx  # Local Guide 카테고리 정의 (LOCAL_CATEGORIES, MARKER_STYLE)
│   │   ├── FeedbackModal.tsx   # 피드백 모달
│   │   ├── ForceUpdateCheck.tsx # 강제 업데이트 체크
│   │   ├── SpotlightGuide.tsx  # 스포트라이트 가이드
│   │   └── NaverMapView.tsx    # 네이버 맵 (현재 미사용)
│   │
│   ├── context/
│   │   └── GlowContext.tsx     # 탭 하단 글로우 색상 관리
│   │
│   ├── theme/
│   │   └── theme.ts            # 디자인 시스템 (colors, shadows, fonts, r() responsive helper)
│   │
│   ├── types/                  # TypeScript 타입 정의
│   └── utils/                  # 유틸리티 함수들
│
├── functions/                  # Firebase Cloud Functions
├── admin-panel/               # 관리자 웹 패널
└── assets/                    # 아이콘, 스플래시 등
```

---

## 🔑 Firebase 컬렉션 구조

| 컬렉션 | 용도 |
|--------|------|
| `users` | 유저 프로필 (하위: saved items) |
| `lounge_posts` | FS Lounge 게시글 (하위: comments, likes) |
| `market_listings` | 마켓 판매 게시글 |
| `local_recommendations` | Local Guide 추천 (하위: likes) |
| `dolphin_chats` | DM 채팅 (하위: messages) |
| `dolphin_notifications` | 알림 |
| `dolphin_announcements` | 공지사항 |
| `school_calendar` | 학교 캘린더 (Cloud Functions에서 Veracross 동기화) |
| `lunch_menus` | 점심 메뉴 (서버에서만 쓰기) |
| `posts` | Lost & Found 게시글 (레거시) |
| `chats` | Lost & Found 채팅 (레거시) |
| `app_config` | 앱 설정 (관리자 목록 등) |
| `app_banners` | 앱 배너 |
| `dolphin_feedback` | 유저 피드백 |
| `config` | 설정 |
| `reports` | 신고 |
| `tech_*` | Tech Support 관련 |

---

## 🔐 Firebase 보안 규칙

### Firestore (`firestore.rules`)
- 대부분의 컬렉션: 인증된 유저만 읽기/쓰기 가능
- `school_calendar`, `lunch_menus`: 읽기만 가능 (Cloud Functions에서 쓰기)
- `rate_limits`: 완전 차단 (서버 전용)

### Storage (`storage.rules`)
- `lounge/{userId}/` - 라운지 사진
- `market/{userId}/` - 마켓 사진
- `local_guide/{userId}/` - Local Guide 추천 사진 ← **최근 추가**
- `chat_images/{chatId}/` - 채팅 이미지
- `posts/` - Lost & Found 사진
- `lostfound/{userId}/` - Lost & Found (레거시)
- 모든 업로드: 이미지만, 5MB 제한, 인증 필수

---

## 📱 탭 구조 (MainTabs.tsx)

| 탭 | 아이콘 | 스크린 | 설명 |
|----|--------|--------|------|
| Home | 🏠 `home` | HomeScreen | 위젯 대시보드 |
| Lounge | 💬 `chatbubbles` | CommunityScreen | FS Lounge + Market 통합 |
| Local | 🗺️ `map` | LocalMapScreen | Local Guide 지도 |
| Lost&Found | 🔍 `search` | LostFoundScreen | 분실물 |
| Messages | 💌 `mail` | ChatListScreen | DM |
| My | 👤 `person` | ProfileScreen | 프로필 |

---

## 🗺️ LocalMapScreen 상세 (가장 복잡한 화면)

### 구조
- **상단**: 검색바 + 카테고리 필 (All, Restaurants, Cafes, Local Tips, Activities, Vegetarian)
- **중앙**: Google Maps MapView (POI 클릭 가능)
- **하단**: Bottom Sheet (peek: 160px, mid: 55%, full: 화면-110px)
  - Animated.Value `sheetY`로 제어
  - PanResponder로 드래그
  - 카테고리 탭 시 bounce 애니메이션 (80px 올라갔다 내려옴)

### 카테고리 (LocalGuideCards.tsx에 정의)
- `restaurant` - 레스토랑 (🍽️ 주황)
- `cafe` - 카페 (☕ 갈색)
- `local_tip` - 로컬 팁 (💡 보라)
- `activity` - 액티비티 (⚡ 파랑)
- `vegetarian` - 채식 (🍃 초록) ← **최근 추가**

### POI (Google Maps 기본 장소)
- `onPoiClick` → `fetchPlaceDetails()` → Google Places API로 상세 조회
- 하단 카드에 **사진, 별점, 리뷰 수, 영업시간, 주소** 표시
- "Directions" 버튼 → Google Maps 앱 길찾기 실행
- ⚠️ **이 기능은 최근 코드에 추가됐으나 아직 빌드/배포 안 됨**

### Google Maps 길찾기 연동
- iOS: `comgooglemaps://` URL scheme 사용
- Fallback: `https://www.google.com/maps/dir/` 웹 URL
- `app.json`에 `LSApplicationQueriesSchemes: ["comgooglemaps"]` 등록됨

---

## 🏠 HomeScreen 위젯

| 위젯 | 컴포넌트 | 스타일 |
|------|---------|--------|
| CalendarWidget | `compact` 모드 | 아이콘: 28×28, 배경 `#FFF4ED` (따뜻한 주황), 그림자 `shadows.md` |
| LunchMenuWidget | `compact` 모드 | 아이콘: 28×28, 배경 `#E0E7FF` (연한 보라), 그림자 `shadows.md` |
| WeatherAQIWidget | - | AQI 표시, 그림자 있음 |
| Quick Access | 그리드 | FS Lounge, Market, Local Guide 등 바로가기 |

---

## 🔨 빌드 & 배포

### EAS Build (클라우드)
```bash
# 프로덕션 빌드 + App Store Connect 자동 업로드
eas build --platform ios --profile production --auto-submit --non-interactive

# ⚠️ EAS 무료 한도 거의 소진 → 로컬 빌드 사용 권장
```

### 로컬 빌드 (추천)
```bash
# 로컬에서 .ipa 생성
eas build --platform ios --profile production --local --non-interactive

# 생성된 .ipa를 App Store Connect에 업로드
eas submit --platform ios --path ./build-XXXXX.ipa --non-interactive
```

### Firebase 배포
```bash
# Firestore 규칙
npx -y firebase-tools@latest deploy --only firestore:rules

# Storage 규칙
npx -y firebase-tools@latest deploy --only storage

# Cloud Functions
npx -y firebase-tools@latest deploy --only functions
```

### 시뮬레이터 실행
```bash
npx expo start
# 또는
npx expo run:ios
```

---

## ✅ 최근 완료된 작업 (이번 세션)

### 1. Calendar/Lunch 위젯 아이콘 일관성
- CalendarWidget `sqStyles.iconCircle`: 28×28, borderRadius 9, 배경 `#FFF4ED`
- LunchMenuWidget `cStyles.iconCircle`: 28×28, borderRadius 9, 배경 `#E0E7FF`

### 2. Vegetarian 카테고리 추가
- `LocalGuideCards.tsx`에 `{ key: 'vegetarian', label: 'Vegetarian', icon: 'leaf' }` 추가
- `LocalMapScreen.tsx`의 `MARKER_STYLE`에 초록 그라데이션 스타일 추가

### 3. Bottom Sheet UX 개선
- 카테고리 탭 시 시트 bounce 애니메이션 (80px 올라갔다 spring으로 내려옴)
- 스크롤/카드 탭 시 시트 자동 확장

### 4. MapPicker 현위치
- `expo-location`으로 현위치 가져와서 맵 초기화
- 커스텀 "현위치 돌아가기" 버튼 추가

### 5. Open Map → Google Maps 길찾기
- `LocalGuideScreen.tsx`: "Open Map" 버튼이 Google Maps 앱에서 경로 안내 실행
- `LocalMapScreen.tsx`: POI "Open in Maps"도 동일
- `app.json`에 `LSApplicationQueriesSchemes: ["comgooglemaps"]` 등록

### 6. Firebase Storage Rules 수정
- `local_guide/{userId}/` 경로 권한 추가 (사진 업로드 가능하게)
- ✅ **서버사이드라 앱 업데이트 없이 바로 적용됨**

### 7. POI 상세 정보 카드 (코드 완료, 미배포)
- Google Places API로 장소 상세 조회 (`fetchPlaceDetails`)
- 하단 카드에 사진, 별점, 리뷰 수, 영업시간, 주소 표시
- Directions 버튼으로 Google Maps 길찾기

---

## ⚠️ 현재 미배포 변경사항

**마지막 배포된 빌드**: Build 44 (1.3.0)
**미배포 코드 변경**:
1. POI 상세 정보 카드 (`LocalMapScreen.tsx`) - Google Places API 연동
2. 카테고리 필 bounce 애니메이션
3. Calendar/Lunch 아이콘 스타일 변경
4. Open Map → Google Maps 길찾기
5. Vegetarian 카테고리 추가
6. MapPicker 현위치 기능

> ⚠️ Build 44에는 위 변경사항 중 일부만 포함됨. **전체 반영하려면 새 빌드 필요**.
> EAS 무료 한도 이슈 → `eas build --local` 사용 권장

---

## 🐛 알려진 이슈

1. **EAS Build 무료 한도**: 거의 소진됨. 로컬 빌드 (`--local`) 사용 필요
2. ~~**Google Places API 비용**: 캐싱 고려 필요~~ → ✅ 2026-06-11 placeId 기반 인메모리 캐시 추가됨
3. ~~**API Key 노출**: 하드코딩~~ → ✅ 2026-06-11 `EXPO_PUBLIC_GOOGLE_MAPS_KEY` 환경변수로 이동 (`LocalMapScreen.tsx`, `LocalGuideScreen.tsx`). 단 `app.json`의 네이티브 맵 키는 그대로 — 진짜 보호는 Google Cloud Console에서 키에 iOS 번들ID 제한 걸 것
4. **Build .ipa 파일 정리**: 루트에 build-*.ipa 파일 다수 쌓여있음 (약 600MB+). 정리 필요
5. **Haptics 에러 로그**: 시뮬레이터에서 `hapticpatternlibrary.plist` 에러 나오지만 실제 기기에서는 무시해도 됨
6. **⚠️ Places API 비활성화 (중요)**: Google Cloud 프로젝트 `596104147964`에서 레거시 Places API와 Places API (New) **둘 다 비활성** → POI 상세 카드(별점·사진·리뷰)가 REQUEST_DENIED로 빈 채 표시됨. 콘솔에서 **Places API (New) 활성화 필요**: https://console.developers.google.com/apis/api/places.googleapis.com/overview?project=596104147964
   - 코드는 2026-06-11에 Places API (New) (`places.googleapis.com/v1`)로 마이그레이션 완료. 활성화만 하면 즉시 작동.
7. **CocoaPods + Ruby 4 버그**: `pod install`이 `Unicode Normalization not appropriate for ASCII-8BIT` 에러로 죽음. 해결: `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 RUBYOPT="-EUTF-8"` 후 실행
8. **로컬 ios/ 폴더는 generated**: `.gitignore`에 포함된 생성 폴더. 네이티브 모듈 추가(예: expo-location)나 app.json 변경 후엔 `npx expo prebuild -p ios --clean`으로 재생성해야 시뮬레이터 디버그 빌드가 정상 동작 (EAS 클라우드 빌드는 항상 fresh prebuild라 무관)

---

## 📌 주요 규칙 / 유저 요구사항

1. **홈화면 피드**: FS Lounge와 Market 피드는 **6개까지만** 표시, "+" 버튼으로 전체 목록 진입
2. **Local Map "ALL"**: 지도에 보이는 범위 내 **모든 타입** local guide 표시 (타입 무관)
3. **현위치 기본**: 맵 관련 UI는 항상 **현위치에서 시작**
4. **Google Maps 연동**: Open Map 버튼은 **구글맵 앱으로 직접 길찾기** 실행
5. **빌드 시**: 항상 TypeScript 체크 (`npx tsc --noEmit`) 후 빌드
6. **변경 연쇄 반영**: 한 곳 바꾸면 연관된 곳도 **반드시** 같이 바꿀 것 (유저 불만 사항)

---

## 🔧 자주 쓰는 명령어

```bash
# TypeScript 타입 체크
cd /Users/junyoung/OPENCLAW/dolphin && npx tsc --noEmit --pretty

# 로컬 빌드 (iOS)
eas build --platform ios --profile production --local --non-interactive

# App Store Connect 업로드
eas submit --platform ios --path ./build-XXXXX.ipa --non-interactive

# Firebase 규칙 배포
npx -y firebase-tools@latest deploy --only storage
npx -y firebase-tools@latest deploy --only firestore:rules

# 시뮬레이터 실행
npx expo start
```

---

## 📝 이전 버전 히스토리

| 버전 | 주요 변경 |
|------|----------|
| 1.0.0 | 초기 출시 (Lost & Found, Chat) |
| 1.1.0 | Lounge, Market 추가 |
| 1.2.0 | Local Guide, Calendar/Lunch 위젯, AQI |
| 1.3.0 | FS Lounge + Market 통합, Local Map 개선, Vegetarian, Google Maps 연동 |

---

---

## ✅ 2026-06-11 밤 세션 (Claude Code) 작업 내역

### 버그 수정
1. **POI 상세 race condition**: A 탭 → 빠르게 B 탭 시 늦게 온 A 응답이 B 카드에 합쳐지던 버그 → placeId 일치 검사로 수정
2. **칩 bounce 시트 점프**: 시트가 mid/full일 때 카테고리 칩 탭 → `lastSnap`/`sheetPosition` 미갱신으로 다음 드래그 때 시트 점프 → `bounceSheetToPeek()` 헬퍼로 통합 수정. 스크롤 자동확장·마커탭·카드탭에도 `setSheetPosition` 동기화
3. **`formatPrice("0")` → "₩0" 표시**: 0원이면 "Free" 반환하도록 수정 (`src/utils/price.ts`) — 홈/마켓 전역 반영
4. **디버그 console.log 4개 제거** (LocalMapScreen 검색)
5. **미사용 import 제거** (`Callout`, `PROVIDER_DEFAULT`), MARKER_STYLE 모듈 스코프로 이동, 검색 디바운스 타이머 unmount 정리

### 기능 개선 (지도)
1. **현위치 시작 (유저 규칙 #3)**: GPS 획득 시 지도 자동 이동 (기존엔 학교 고정)
2. **'All' 리스트 viewport 연동 (유저 규칙 #2)**: 죽은 코드였던 `visibleGuides`를 바텀시트에 연결 — 'All' 선택 시 "N places in view", 지도 이동에 따라 실시간 갱신, 중심 가까운 순 정렬
3. **검색에 커뮤니티 추천 포함**: 검색어가 추천글 제목/내용과 매칭되면 드롭다운 최상단에 표시(카테고리 아이콘+작성자), 탭하면 지도 이동+상세 시트
4. **POI 카드 구글맵 스타일 업그레이드**: Places API (New) 마이그레이션 + 사진 배너, 별점/리뷰 수, 영업중, 주소, Call/Site 버튼, 리뷰 3개 표시 (스크롤 카드). placeId 캐시로 API 비용 절감
5. **팝업/카드 상호 배타**: 지도 탭 시 추천 팝업도 닫힘, POI 탭 시 추천 팝업 닫힘, 마커 탭 시 POI 카드 닫힘

### 시뮬레이터 개발 환경 (중요)
- 시뮬레이터에 설치돼 있던 앱은 **릴리즈 .ipa (내장 번들)** → 코드 수정이 반영 안 됨!
- 디버그 빌드 절차: `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 RUBYOPT="-EUTF-8"` 환경에서 `npx expo prebuild -p ios --clean` → `npx expo run:ios` (자세한 함정은 알려진 이슈 7·8번)
- 시뮬레이터 GPS 설정: `xcrun simctl location booted set <lat>,<lng>`

### ✅ Places API (New) 활성화됨 (유저가 직접 활성화)
POI 카드가 구글맵처럼 작동: 사진 배너 + 별점/리뷰 수 + 영업중 + 주소 + Directions/Call/Site 버튼 + 실제 리뷰 3개. 시뮬레이터에서 검증 완료.

---

## ✅ 2026-06-11 심야 세션: 전체 앱 감사 + 보완

### 전체 감사 결과로 구현된 것
1. **좋아요 알림 (라운지 + Local Guide)**: 기존엔 좋아요 알림이 전혀 없었음 → `dolphin_notifications` 기록 + 푸시 발송 추가 (자기 글 좋아요는 제외)
2. **지도에서 글 관리**: LocalMapScreen 상세 시트에 좋아요 토글(팝업·시트 양쪽) + 작성자용 Edit/Delete 버튼. Edit는 `LocalGuide`로 `openItemId`+`startEdit` 파라미터 전달해 해당 글 수정모드 자동 진입 (LocalGuideScreen에 파라미터 핸들링 추가)
3. **열린 팝업/시트 실시간 동기화**: Firestore 스냅샷 갱신 시 selectedGuide/sheetDetail 자동 업데이트 (좋아요 카운트 즉시 반영)
4. **사진 다중 지원 완성**: 지도 상세 시트에 photos[] 스와이프 캐러셀 + 장수 배지, AddRecommendationScreen 4장 업로드 (기존 1장)
5. **My Posts 통합**: Lounge / Local Guide 탭으로 분리, 추천글도 한 곳에서 수정·삭제 가능
6. **홈 배너 연결**: 관리자가 만들던 `app_banners`가 어디에도 표시 안 되던 죽은 기능 → 홈 AQI 아래 가로 스와이프 배너로 렌더링
7. **설정 보완**: Privacy 섹션에 차단 유저 목록+Unblock 추가 (기존엔 차단만 되고 해제 UI 없었음), 앱 버전 하드코딩 → Constants에서 읽기
8. **OTA 업데이트 (expo-updates + EAS Update)**: 설치·설정 완료. **다음 빌드(45)부터** `eas update --channel production` 으로 앱스토어 심사 없이 JS 수정 배포 가능. runtimeVersion policy = appVersion (같은 스토어 버전끼리만 OTA 적용)
9. **죽은 코드 정리**: NaverMapView.tsx 삭제 (미사용 확인)

### 감사에서 발견됐지만 아직 미구현 (다음 후보)
- **Tech Support 미연결**: `src/screens/tech/` (Gemini AI 챗 + 공지) 완성돼 있는데 네비게이션에 등록 안 됨 → 어디서 진입할지 결정 필요 (홈 Quick Access? 프로필 메뉴?)
- **Lost & Found 푸시 딥링크 없음**: L&F 채팅 푸시 탭해도 화면 이동 안 함
- **Local Guide 댓글 없음**: 라운지 글은 댓글 있는데 추천글은 없음 (참여도 올리려면 추가 고려)
- **알림 설정 토글이 발송과 미연동**: Settings 알림 토글은 AsyncStorage에만 저장, 실제 푸시 발송 필터링은 일부만 적용 — 수신자 측 필터링은 서버(Cloud Functions) 이전 권장
- **SellerDetailScreen**: 등록돼 있으나 진입 경로 없음
- **사용 안 된 Cloud Function**: `sendNotification` callable (클라이언트가 직접 Expo Push API 호출하는 구조)

---

## ✅ 2026-06-12 새벽 세션: Local Guide 대형 업데이트

1. **Google Places 연동 추천 작성 (중복 방지)**
   - AddRecommendationScreen에 구글 장소 검색(Places API New, 송도 반경 15km 바이어스) → 선택 시 이름·주소·좌표 자동 채움 + 초록 "Linked to Google Maps" 카드 (별점·리뷰 수 표시)
   - 추천 문서에 `placeId` 저장. **같은 placeId로 이미 추천이 있으면** "Already recommended 🎉" 알림 → "View existing"(기존 글로 이동) / "Add mine anyway" 선택
   - 주의: 기존 데이터엔 placeId가 없어 소급 중복감지는 안 됨 (신규 작성분부터 적용)
2. **POI 카드 → "Recommend to Community" 버튼**: 구글 장소 카드에서 바로 추천 작성으로 전환, placeId·이름·좌표·주소·별점 자동 전달 (시뮬레이터 검증 완료)
3. **Local Guide 댓글**: `local_recommendations/{id}/comments` 서브컬렉션 + 공용 컴포넌트 `RecommendationComments` — 지도 상세 시트와 LocalGuide 상세 모달 양쪽에서 댓글 보기/작성/본인삭제. 작성자에게 알림+푸시. `commentCount` 필드 유지. firestore.rules 배포 완료
4. **알림 설정 토글 실전 연동**: 설정 토글이 `users/{uid}.notifPrefs`에 미러 → `sendPushToUser`와 ChatRoom 발송부가 수신자 설정(마스터/카테고리) 확인 후 발송. 인앱 알림 기록은 그대로 유지(푸시만 필터)
5. **Tech Support 완전 제거**: `src/screens/tech/` 삭제, firestore.rules의 tech_* 규칙 제거, 관리자 기본 배너 문구 교체
6. **Lost & Found 정리**: 현행 L&F 채팅은 dolphin_chats+ChatRoom 경유라 푸시 딥링크 정상 작동 확인. 도달 불가능한 레거시 모듈(lostandfound/navigation, ChatScreen·AuthScreen·FeedScreen 등 7개 화면 + LostFoundTabScreen) 삭제

7. **Open Map이 좌표로 뜨던 문제 수정**: 길찾기 URL을 `destination=장소이름 + destination_place_id=placeId` 형식으로 변경 (`src/utils/maps.ts`의 `openDirections()` 공용 유틸) — 구글맵에 좌표 대신 가게 이름이 뜸. placeId 없는 글은 기존 좌표 방식 폴백. LocalGuide "Open Map"과 지도 POI "Directions" 모두 적용
8. **기존 추천글 placeId 백필**: `scripts/backfill_place_ids.mjs` (functions/ 디렉토리에서 실행, 좌표 200m 이내 매칭만 인정) — 3건 모두 placeId 부여 완료. Toulon은 작성자가 핀을 잘못 찍어놔서 실제 가게 위치(37.3859, 126.6435)로 좌표·주소도 정정함

9. **구글 장소 칩 (GooglePlaceChip)**: placeId 있는 추천글의 상세(지도 시트·팝업·LocalGuide 모달)에 구글맵 공식 이름+실시간 별점 칩 표시 — 예: "📍 툴롱 Toulon ★4.4 (303) ›". 탭하면 구글맵의 해당 가게 페이지가 열림 (`openPlaceInGoogleMaps`, query_place_id). 기존 3개 레스토랑 모두 백필된 placeId로 칩 표시됨 (시뮬레이터 검증)
10. **지도 줌 버튼**: LocalMapScreen 왼쪽에 +/− 버튼 (시트 peek 상태에서 표시, 현재 중심 기준 2배 줌인/아웃)

11. **Local Map 네비게이션 대개편** (2026-06-12 오전):
   - **초기 뷰**: 'All' 기본 선택 + 모든 핀과 현위치가 보이게 `fitToCoordinates` 자동 줌 (GPS 늦으면 2.5초 후 핀만으로 fit)
   - **Community Picks ✨**: 칩 아래 초록 그라데이션 버튼 → 시트 풀로 모든 추천을 **카테고리별 섹션**(아이콘+카운트)으로 그룹 표시. 항목 탭 → 지도 이동+상세 시트, 뒤로가면 픽스 리스트로 복귀. 엣지 스와이프로도 닫힘
   - **상세 시트 → 실제 게시글**: "View Full Post"(초록) + "Directions"(파랑) 버튼 추가. 마커 팝업의 "View"도 카테고리 리스트가 아니라 **해당 게시글로 직행** (`openItemId`)
   - **"우리 지도에서 보기"**: LocalGuide 게시글의 Location 카드가 구글맵 대신 **Dolphin 지도로 이동해 해당 핀+상세 시트 자동 오픈** (`focusItemId`/`focusTs` 라우트 파라미터). Directions(구글 길찾기)는 보조 버튼으로 유지
   - 순환 네비게이션 완성: 지도 ↔ 픽스 리스트 ↔ 상세 시트 ↔ 게시글 ↔ 다시 지도

12. **홈 배너 기능 완전 삭제** (유저 요청): HomeScreen 배너 UI, AdminScreen 배너 탭/시드, firestore.rules의 app_banners, Firestore 문서까지 전부 제거
13. **Local Guide 첫 방문 온보딩**: 초록 그라데이션 모달 (Explore the map / Community Picks / Tap any place / Share your favorites 4단계 안내 + "Let's explore!" CTA). `@local_guide_onboarded` AsyncStorage 플래그
14. **지도 버튼 재배치**: 줌 +/− 필을 왼쪽 하단(시트 바로 위, FAB와 대칭)으로, 하트·현위치 버튼은 FAB 바로 위 정렬 — 화면 중앙에 떠 있던 문제 해결
15. **Admin Panel 전면 개편**:
   - **Reports 탭 (신규, 기본)**: `reports` 컬렉션 처리 큐 — Pending/All 필터, 신고 유형·사유·대상·신고자 표시, "Delete Content"(유형별 컬렉션 자동 매핑 후 삭제+reviewed 처리) / "Dismiss" 버튼, 탭에 pending 카운트 배지
   - **Local Guide 탭 (신규)**: 모든 추천글 목록(썸네일·카테고리·작성자·좋아요) + 삭제
   - **App 탭 (신규)**: 강제 업데이트 설정 (`app_config/version`의 minimumVersion·latestVersion·updateMessage) 직접 편집 — 기존엔 콘솔에서만 가능했음
   - Stats에 Local Guide 수·Pending Reports 추가, 버전 표시 Constants 연동, Banners 탭 제거
   - ⚠️ 참고: 신고 UI(showReportBlockMenu)는 contentType을 'post'|'listing'|'comment'|'chat_message'로 보냄. Local Guide 글에는 아직 신고 버튼 없음 (다음 후보)

16. **게시글(LocalGuide 상세) 리디자인**: 풀폭으로 꽉 차던 레이아웃 → 라운드 코너 사진 캐러셀(좌우 여백+페이지 도트), 카테고리 뱃지, 큰 제목, 작성자 행(아바타+이름+시간+좋아요 필 버튼), 구분선, 여유 있는 본문 행간. 기존 하단 author/like footer는 작성자 행으로 통합·제거

17. **지도 시트 상세의 "Directions" → "Show on Map"**: 지도 화면 안에서는 구글맵으로 보내지 않고, 시트를 peek로 내리며 해당 핀으로 줌인 (상세는 시트에 유지 — 다시 올리면 그대로). 실제 구글 길찾기는 게시글(LocalGuide 상세)의 Location 카드에 유지

18. **홈 화면 모던 폴리시**: 헤더에 날짜 라벨("Friday, June 12") + 타이틀 확대, 헤더 보더 제거(콘텐츠와 시멀리스), 섹션 라벨을 대문자 마이크로 라벨(QUICK ACCESS 등)로 통일, Quick Access를 파스텔 풀배경 → 화이트 카드+파스텔 아이콘 squircle로, "See all" 브랜드 그린, 마켓 카드 보더+라운드 보강, Free 가격 초록 강조

### 홈 What's New 온보딩 (2026-06-12)
- `HomeFeaturesIntro.tsx`: 3슬라이드 What's New 모달 (Calendar/Lunch/AQI) — 실제 앱 스크린샷 에셋(`assets/onboarding/feature_*.png`, 시뮬레이터 캡처 크롭) + 슬라이드별 액센트 컬러(오렌지/인디고/앰버), 스와이프+Next/Got it, 도트
- **기존 유저에게만 1회** (`@home_features_v140` 플래그). 신규 유저는 첫-실행 온보딩이 우선이라 What's New는 자동 스킵 처리
- 다음 버전에서 비슷한 공지 필요하면 SLIDES 배열과 플래그 키(v150 등)만 갈아끼우면 됨

### My Likes + 유저별 좋아요 인덱스 (2026-06-12)
- **새 데이터**: `users/{uid}/liked_recs/{recId}` — 좋아요 미러 인덱스. LocalMapScreen·LocalGuideScreen의 toggleLike가 양쪽(기존 likes 서브컬렉션 + 미러)에 쓰고 지움. 기존 좋아요 8건 admin 스크립트로 백필 완료
- 양쪽 화면의 좋아요 상태 로딩을 lazy getDoc → 이 인덱스 onSnapshot 구독으로 교체 (실시간·읽기 절약)
- **Community Picks 맨 위에 "My Likes" 섹션**: 내가 좋아요한 추천글 전부, 빨간 하트 아이콘 헤더. 없으면 섹션 숨김

### Community Picks cuisine 필터 (2026-06-12)
- Picks의 Restaurants 섹션 헤더 아래에 텍스트 전용 미니멀 칩 (All + 존재하는 cuisine만, 이모지 없음). 활성 = 다크 슬레이트(#0F172A) 필, 비활성 = 라이트 그레이. `picksCuisine` state, openPicks 시 리셋
- **Picks는 카테고리당 3개 미리보기** + 섹션 하단 "View all N {category} ›" 버튼(항상 표시) → LocalGuideScreen 전체 리스트로 진입 (거기서 cuisine 필터로 탐색)

### 그림자 시스템 정리 (2026-06-12)
- **지도 마커 네모 그림자 버그**: 커스텀 마커는 비트맵으로 래스터돼서 투명 배경에 shadow를 주면 회색 사각형이 생김 → `markerPin`에서 shadow 전부 제거 (주석으로 이유 명시). **지도 마커엔 절대 shadow 금지**
- **overflow:'hidden' + shadow 조합 전수 수정 (15곳)**: iOS에서 overflow hidden이 그림자를 클립해서 그림자가 안 보였음 (Calendar 카드가 Lunch와 달라 보였던 원인). 패턴: overflow 제거 + 풀블리드 자식(이미지·그라데이션 헤더)에 직접 borderTop(Left|Right)Radius 부여. 적용: HomeScreen market/lounge 카드, Market/Batch/Seller itemCard, ProfileSubScreens saved/settingCard, ProfileScreen menuSection, AdminScreen infoCard, Calendar/Lunch/AQI 위젯들. **새 카드 만들 때 이 패턴 유지할 것**

### Cuisine 세부분류 (2026-06-12)
- **vegetarian 카테고리 삭제** → Restaurants의 cuisine 태그로 흡수. `LOCAL_CATEGORIES`에서 제거, `CUISINES`/`cuisineLabel()` export 추가 (`LocalGuideCards.tsx`): korean/western/chinese/japanese/vietnamese/indian/mexican/bbq/vegetarian/fusion/other
- 데이터: `local_recommendations.cuisine` (string|null, restaurant일 때만). 기존 vegetarian 글 0개라 마이그레이션 불필요. 기존 레스토랑 3개는 admin 스크립트로 백필 (Toulon→western, 오수옥·신복관→korean)
- 작성: Restaurants 선택 시 "Cuisine (optional)" 칩 행 노출 (이모지+라벨, 재탭으로 해제)
- 표시: LocalGuide 리스트 상단에 cuisine 필터 칩(사용된 것만+카운트, All 포함), 카드 제목 옆 뱃지, 게시글 상세/지도 시트/팝업에 카테고리 뱃지 옆 cuisine 뱃지
- 수정: edit 모드에서 cuisine 변경 가능 (`editCuisine`)

### 지도 현위치 정책 (2026-06-12)
- **작성/위치설정 지도는 항상 현위치에서 시작**: AddRecommendationScreen(마운트 GPS + 역지오코딩 자동 주소), MapPickerScreen(initialLat 없으면 GPS), LocalGuide MapPickerModal(기존 GPS 유지). 단, 유저가 장소를 고르면(`locationPickedRef`) GPS가 덮어쓰지 않음
- **메인 Local 지도 첫 화면만** fitToCoordinates로 모든 핀+현위치가 보이게 축소 (`didFitRef`로 1회만, 이후 자유 탐색)

### Cuisine AI 자동 판별 (2026-06-12 저녁) — 수동 선택 완전 제거
- **유저가 cuisine을 고르지 않음.** Restaurants 글 게시/수정 시 자동 판별. 작성·수정 화면의 cuisine 칩 UI 제거 → 보라색 "detected automatically" 힌트로 교체
- `classifyCuisine()` (src/utils/gemini.ts): ① Google Places `primaryType/types` → cuisine 결정적 매핑 (korean_restaurant→korean, hamburger_restaurant→burger, cafe/bakery→cafe 등 30+ 타입, 무료·즉시) ② 매핑 실패 시 gemini-2.5-flash 텍스트 분류 (한글 상호명이 최강 시그널이라고 프롬프트에 명시: ~국밥→korean, ~떡볶이→bunsik). 실패 시 null (글 게시는 막지 않음)
- AddRecommendation: 제출 시 사진 업로드와 **병렬**로 분류 실행. Places 검색 fieldMask에 `types,primaryType` 추가, POI prefill에도 types 전달
- LocalGuide 수정 저장 시 재분류 (실패하면 기존 cuisine 유지)
- **CUISINES 확장** (17종): korean/bunsik/japanese/chinese/western/burger/pizza/chicken/bbq/vietnamese/thai/indian/mexican/cafe/vegetarian/fusion/other — 필터 칩은 존재하는 것만 렌더하므로 안전
- 검증: Starbucks RESERVE 게시 → cuisine=cafe 자동 분류, Picks 필터에 Café & Dessert 칩 자동 등장 확인 (테스트 글 삭제 완료). Gemini 단독 테스트: 엽기떡볶이→bunsik, 맘스터치→burger, 교촌치킨→chicken, 쌀국수→vietnamese ✓

### AddRecommendation 지도 개선 (2026-06-12 저녁)
- **Place 선택 → 아래 Location 지도가 자동으로 그 위치로 이동**: MapView를 controlled `region` → `initialRegion`+ref 방식으로 전환, lat/lng state 변경 시 `animateToRegion` effect (장소 링크·POI prefill·MapPicker 복귀·GPS fix 전부 이 경로)
- **현위치 안정화**: `getLastKnownPositionAsync` 먼저(즉시) → `getCurrentPositionAsync(Balanced)`로 refine. 송도 폴백이 화면에 머무는 시간 최소화

### 🔥 지도 크래시 수정 (2026-06-12 저녁) — 중요
- **증상**: 핀 개수가 실시간으로 바뀔 때(새 글 onSnapshot 등) `-[AIRGoogleMap insertReactSubview:atIndex:]` SIGABRT (NSArrayM index out of bounds)
- **원인**: MapView children에 조건부 마커(`{selectedPoi && <Marker/>}`)가 있으면 Fabric interop 레이어의 삽입 인덱스가 stale해짐
- **수정**: POI 마커를 **항상 마운트**하고 selectedPoi 없을 땐 opacity 0 + (0,0) 좌표로 파킹 → children 배열 길이 고정. **MapView 안에서 조건부 렌더링 금지** — 같은 패턴 새로 만들지 말 것

### 🔥 안드로이드 마커 깨짐 수정 (2026-06-13) — 중요
- **증상**: 안드로이드에서 커스텀 마커가 둥근 핀+아이콘 없이 작은 CSS 삼각형(화살표)만 렌더 (iOS는 멀쩡)
- **원인**: `tracksViewChanges={false}`가 안드로이드에서 마커를 **Ionicons 글리프/레이아웃이 그려지기 전에** 비트맵으로 즉시 동결 → 아이콘+핀 머리 빠진 반쪽짜리 스냅샷이 영구 고정. 동기 렌더되는 markerArrow(테두리 삼각형)만 남음
- **수정** (LocalMapScreen): 화면 레벨 `tracksMarkers` state — `displayedGuides` 변경 시 `true`로 2.2초 추적 후 `false`로 동결. 마커 prop `tracksViewChanges={tracksMarkers}`. 아이콘이 그려진 뒤 올바른 비트맵을 캡처
- **검증**: 에뮬레이터에서 OTA 적용 후 빨강(포크 아이콘)·보라(상점)·초록 물방울 마커 정상 렌더 확인. **커스텀 뷰 마커엔 tracksViewChanges=false 직접 박지 말 것 — 반드시 paint 후 동결**
- 줌도 더 타이트하게: `SONGDO_REGION` latΔ 0.05→0.036, lngΔ 0.04→0.028 (사용자 요청 "아까 말한 부분까지 확대")

### 새 글/매물 알림 시스템 (2026-06-15) — Cloud Function 트리거
- **발송 = Cloud Function Firestore 트리거** (`functions/src/notifyOnPost.ts`, v2 onDocumentCreated, us-central1, 배포 완료):
  - `onLoungePostCreated`: lounge_posts 생성 시 category가 **general/question/event**일 때만 → 전원 푸시 `[F&S Lounge] {제목}` / {본문}. tip/life/food/housing은 알림 안 감 (요청대로)
  - `onMarketListingCreated`: market_listings 생성 시 → 전원 푸시 "🛍️ Dolphin Market / A new item was just listed" (구체 문구 안 씀). batchId 멀티아이템은 `notif_batches/{batchId}` 트랜잭션으로 1회만
  - **푸시 토큰을 서버(admin SDK)에서만 읽음** → 클라이언트 팬아웃의 토큰노출/스팸벡터 회피. 작성자 본인 제외. notifPrefs(all + lounge/market) 서버측 존중. Expo 100개씩 배치
- **토글 (OTA)**: CommunityScreen 헤더 벨 = 세그먼트 인식형(Community→lounge, Market→market), MarketScreen 독립 헤더에도 market 토글. `users/{uid}.notifPrefs.{lounge,market}` + AsyncStorage `@notif_settings` 양쪽 기록 (기존 Settings 토글과 동일 필드)
- NotificationsScreen: NOTIF_META에 lounge/market 아이콘 추가 + pref 필터에 lounge/market 반영
- **테스트**: AdminScreen Announce 탭에 "Send test notification (only me)" 버튼 → 본인 uid로 dolphin_notifications 1건. 에뮬 검증: `[F&S Lounge] ...` 형식으로 알림함에 정상 렌더 ✓ (실제 푸시는 물리기기 필요 — 시뮬레이터 불가라 인앱으로 검증)
- **배포 함정**: v2 트리거 첫 배포 시 ① calendarSync의 defineSecret이 Secret Manager API(비활성)를 조회해 막힘 → index.ts에서 calendarSync export 임시 주석 후 `--only`로 새 함수만 배포(기존 함수 미삭제), 배포 후 원복. ② Eventarc 서비스 에이전트 권한 전파에 몇 분 → 재시도하면 성공
- ⚠️ 서비스계정엔 API 활성화 권한 없음(403) — Secret Manager API가 필요하면 프로젝트 소유자가 콘솔에서 켜야 함

### 피드백 대응: 위치선택 버그 + 다중사진 + 커뮤니티 사진 (2026-06-13)
- **🐛 버그 (Andre): "위치 핀 찍으면 빈 새 글로 튕김" 수정** — 원인: `MapPickerScreen.handleConfirm`이 `goBack()`이 아니라 `navigation.navigate('AddRecommendation', ...)`로 이름 복귀 → 스택에 다른 화면(중복가드가 push한 LocalGuide 등)이 끼면 navigate가 **새 AddRecommendation을 push**해서 입력값이 다 날아감. 수정: `getState().routes`로 직전 route key를 찾아 `CommonActions.setParams({...selectedNonce})` + `goBack()`. AddRecommendation 수신 effect deps에 `selectedNonce` 추가(같은 핀 재선택도 반영). **에뮬 검증: 제목 입력 → 위치선택 → 복귀 시 제목 유지 확인 ✓**
- **다중 사진 선택**: AddRecommendationScreen·LocalGuideScreen의 `pickPhoto`를 `allowsMultipleSelection:true` + `selectionLimit:remaining` + `.slice(0,4)`로. `allowsEditing`/`aspect` 제거(iOS 멀티선택과 충돌, 업로드 시 1024w 리사이즈됨). 힌트 "select several at once"
- **🆕 커뮤니티 사진 기여**: 중복가드로 "한 장소 한 번만"이라, 대신 **남이 기존 추천에 자기 사진을 추가**. 데이터: `local_recommendations/{recId}/contributedPhotos/{autoId}` 서브컬렉션 `{url,authorId,authorName,authorPhoto,createdAt}` (원글 photos 배열 안 건드림 → 소유권 보존, 규칙 수정 불필요 — 서브컬렉션 쓰기 이미 허용). UI: 상세 캐러셀에 원글사진+기여사진 한 갤러리로 병합, 기여 슬라이드 좌하단 "by 이름", 우하단 "Add photo" 칩(누구나), 0장이면 점선 "Be the first to add a photo". 작성자에 알림. 중복 알림창도 "Add your photos" 긍정동선으로. soft cap 8장. **에뮬 검증: Add photo 칩 정상 렌더 ✓**

### ⚠️ Veracross 배우자/동문 조회 — 현재 불가 (스코프 문제)
- Veracross 연동은 **캘린더 이벤트 전용** (`functions/src/calendarSync.ts`, OAuth scope=`events.group_events`만). 사람/가족/배우자 데이터 접근 불가(401/403). bchae 배우자 자동조회하려면 학교 Veracross 관리자가 **people/household 스코프 새 OAuth 클라이언트** 발급 + 이메일→person→household 코드 필요. 정책 결정 선행.
- (참고: 점심메뉴는 Veracross 아님 — 구글드라이브+Gemini. ⚠️ Veracross client_secret이 `calendarSync.ts`·`seed_calendar.mjs`에 평문 커밋됨 → 로테이션 권장)

### 지도 고정 송도 뷰 + Local 재탭 리센터 (2026-06-13) — 에뮬레이터 검증 완료
- **문제**: 누가 다른 한국 지역에 팁을 올리면 초기 `fitToCoordinates(모든 핀)`이 전국 뷰로 줌아웃됨
- **해결**: `SONGDO_REGION` 상수 추가, MapView `initialRegion=SONGDO_REGION`, **초기 fit 이펙트 제거** → 항상 송도 고정 뷰로 열림. (죽은 `didFitRef` 정리 — 멀티에이전트 리뷰 지적 반영)
- **Local 탭 재탭 리센터** (MainTabs.tsx): `tabPress` 리스너에서 `navigation.isFocused()`면 `setParams({resetMapTs})`. 다른 탭→1탭 진입, 2탭 리센터 ("두 번 누르면"). LocalMapScreen이 `route.params.resetMapTs` 이펙트로 `animateToRegion(SONGDO_REGION)`. (처음엔 350ms 더블탭 윈도우였으나 adb 테스트·UX 안정성 위해 focused-tab 재탭 패턴으로 변경 — iOS scroll-to-top 관용 패턴)
- **에뮬레이터(Pixel_7) 실측 검증**: 앱 무크래시 / 안드로이드 구글맵 타일 렌더(회색 아님, apiKey 정상) / 하단 탭바 시스템 네비 안 겹침 / Local 첫 진입 송도 고정 / 인천 전역 줌아웃 상태에서 재탭 → 송도 복귀 확인 ✓
- **에뮬 함정**: 에뮬레이터 DNS가 중간에 죽으면(`UnknownHostException`) ForceUpdateCheck가 Firestore 응답 대기로 빈 navy 화면에 멈춤 → `emulator -dns-server 8.8.8.8,8.8.4.4`로 콜드 재시작하면 복구. 코드 문제 아님

### Android APK 빌드 (2026-06-13) — 직접 다운로드 배포
- **목적**: Google Play 미설정 → APK 직접 다운로드 배포
- **eas.json `apk` 프로파일 완성**: 기존엔 `android.buildType:apk`만 있어 env(Firebase·Maps 키)·channel 누락 → 프로덕션과 동일한 env 전체 + `channel:production` + `autoIncrement` + `distribution:internal` 추가. 안 그러면 APK에서 지도 회색·Firebase 깨짐
- **🔥 android.config.googleMaps.apiKey 추가** (app.json): iOS엔 `ios.config.googleMapsApiKey`가 있었지만 Android엔 없었음 → 네이티브 `PROVIDER_GOOGLE` 지도가 안 뜸. 같은 키 추가. **주의: Google Cloud에서 "Maps SDK for Android"가 활성화돼 있어야 하고 키 제한이 Android 허용이어야 함**
- **하단 탭바 safe-area** (MainTabs.tsx): `edgeToEdgeEnabled:true`라 앱이 시스템 바 아래까지 그림 → 기존 고정 `height:88`이 Android 네비바(뒤로/홈/멀티)와 겹침. `useSafeAreaInsets().bottom`으로 동적 높이(`60+inset`)+`paddingBottom` 적용. 3버튼·제스처 네비 모두 호환
- **전역 StatusBar** (App.tsx): `<StatusBar style="dark" translucent>` 추가 — 밝은 화면 상단에서 아이콘 보이게
- Android 뒤로가기 버튼: react-navigation이 자동 처리(스택 pop), `predictiveBackGestureEnabled:false` 유지
- 빌드: `eas build --platform android --profile apk` (클라우드, keystore 자동생성, versionCode 3). 완료 시 expo.dev 빌드 페이지에서 .apk 다운로드 URL 제공

### 새 앱 인트로 — AppIntro 4슬라이드 (2026-06-13)
- `src/components/AppIntro.tsx` — HomeFeaturesIntro(3슬라이드 What's New) **대체·삭제**. 신규 설치+업데이트 유저 모두 1회 노출 (`@app_intro_v141` 플래그; 마운트 시 구 플래그들 seen 마킹 유지)
- 슬라이드: ① Welcome(홈 위젯, 블루) ② Market moved into F&S Lounge(오렌지) ③ New: Local Guide(그린) ④ Find your way around — 6개 탭 아이콘+설명 리스트(인디고, "Let's go")
- 스크린샷 에셋: `assets/onboarding/intro_home/lounge/local.png` (시뮬레이터 1206px 캡처 → sips 크롭 offset 200, 1460h → 900px 리사이즈)
- `intro_lounge.png`는 상단만 크롭(743×340, 상품 카드 제거)하고 PIL로 Market 세그먼트에 빨간 타원+화살표 주석을 베이크 — 헤더·탭 위치가 크게 강조돼 보임
- **🔥 버그 픽스**: Modal 안 paging ScrollView가 비동기 레이아웃 후 마지막 페이지로 드리프트 (첫 Next가 "Let's go"로 인식돼 바로 닫히던 버그). 해결: visible 시 idx 0 + scrollTo(0) 핀, `onContentSizeChange`에서 idxRef 위치로 재고정. **Modal 안 가로 paging ScrollView 쓸 때 이 가드 필수**
- 다음 공지 때: SLIDES 배열 + 플래그 키(v150 등)만 교체

### Announcement 팝업 관리 (2026-06-13)
- **구조**: `dolphin_announcements`의 최신 1개가 홈 팝업으로 모든 유저에게 노출 (유저별 "Got it" 시 `seen_announcement_{id}` AsyncStorage로 dismiss)
- **Admin Announce 탭에 "Sent Announcements" 목록 추가**: 최신 항목에 LIVE POPUP 배지, 각 항목 삭제 버튼(확인 다이얼로그). 삭제하면 팝업이 전 유저 홈에서 **실시간으로** 사라짐 (HomeScreen onSnapshot이 빈 결과/다른 최신 doc을 받으면 팝업 클리어하도록 수정)
- **강제 업데이트는 기존 구현 확인**: `ForceUpdateCheck.tsx`(App.tsx 루트 래핑) — `app_config/version`의 `minimumVersion`보다 앱 버전이 낮으면 풀스크린 차단(Update→App Store). Admin "App" 탭의 Version Config에서 minimumVersion/latestVersion/updateMessage 관리. __DEV__에선 비활성. **주의: minimumVersion 올리기 전에 해당 버전이 App Store에 실제 출시됐는지 확인할 것** (아니면 유저가 업데이트할 방법 없이 차단됨)
- **✅ 강제 업데이트 활성화 (2026-06-13)**: 1.4.0 App Store 심사 통과 확인 후 Admin App 탭에서 `minimumVersion: 1.2.0 → 1.4.0`, `latestVersion: 1.4.0`, 메시지 설정. **이제 1.3.0 이하 유저는 앱 실행 시 풀스크린 업데이트 화면**(닫기 불가, Update→App Store)만 보임. 시뮬레이터(1.3.0 dev 빌드)에서 __DEV__ 우회 임시 해제해 실경로 검증 완료 후 원복

### 레거시 온보딩 전면 삭제 (2026-06-13) — 겹침 버그 해결
- **문제**: 신규 유저에게 옛 풀스크린 OnboardingScreen → SpotlightGuide 투어 → What's New까지 겹쳐서 뜨는 구조였음
- **삭제된 것**: `OnboardingScreen.tsx`(옛 첫실행 4슬라이드), `SpotlightGuide.tsx`(어두운 배경+밝은 하이라이트 instruction 투어 — Home/Lounge/Market 3곳), LostFoundScreen 내장 OnboardingView(초록 4슬라이드 게이트) — 파일/코드/스타일 전부 제거
- **남은 인트로는 단 2개**: 홈 What's New(`HomeFeaturesIntro`, `@home_features_v140` 1회) + Local Guide 첫방문 팝업(`@local_guide_onboarded`) — 둘 다 최근 제작
- HomeScreen 마운트 시 레거시 플래그들(`@has_onboarded_dolphin`, `@guide_home/lounge/market`, `@has_onboarded_lf`)을 seen으로 마킹해서 옛 코드 경로가 부활해도 재노출 불가
- 신규 유저도 이제 What's New를 봄 (이전엔 풀 온보딩이 대신이라 스킵됐었음)
- OTA 배포 완료 (334b9daa, 2026-06-13)

### ✅ v1.4.0 (Build 45) 배포 완료 — 2026-06-12 새벽
- 버전 1.3.0 → **1.4.0** 범프 (OTA runtimeVersion 경계)
- `.env`가 EAS 패키징에서 빠지는 문제 대비, **eas.json production 프로필에 EXPO_PUBLIC_* env 전부 명시** (특히 GOOGLE_MAPS_KEY는 코드 폴백이 없어 필수)
- 로컬 빌드: `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 RUBYOPT="-EUTF-8" npx eas-cli build --platform ios --profile production --local --non-interactive` → `build-1781195571007.ipa`
- `eas submit --path ...` → **App Store Connect 업로드 성공** (Apple 처리 5-10분 후 TestFlight 노출)
- **이 빌드부터 OTA 활성화**: 이후 JS-only 수정은 `eas update --channel production --message "..."` 로 심사 없이 즉시 배포 (단, 1.4.0 빌드에만 적용됨 — appVersion policy)

## 🏠 2026-07-14 세션: Faculty Housing 탭 프로토타입 → **2026-07-17 접음(코드 삭제됨)**

> 유저 결정으로 프로토타입 폐기. `HousingScreen.tsx` 삭제, MainTabs 원복. 아래 기록은 나중에 다시 만들 때 참고용.

- **배경**: 해외에서 오는 신규 교사들에게 학교가 송도 아파트 4단지를 제공 — Harbor View, Well County, SK View + 1개(유저가 이름 기억 못 함, 임시로 "First World/더샵 퍼스트월드"로 넣음 — **실제 이름 확인 후 교체 필요**)
- **신규 파일**: `src/screens/HousingScreen.tsx` — 단지 선택 카드(가로 스크롤) → 단지별 Q&A 게시판(질문/팁/소셜 태그, 고정글, "Ask {단지}" FAB + 작성 모달) + "Settling In" 신규 교사 정착 팁 아코디언(첫 주 체크리스트/아파트/교통/쇼핑)
- **MainTabs.tsx**: `Housing` 탭 추가 — **교사 전용**(`!isStudent`), 아이콘 `business`, 글로우 색 `#F97316`(오렌지)
- **⚠️ 프로토타입 상태**: 전부 목데이터(로컬 state), Firestore 연동 없음. 화면 우상단 PROTOTYPE 배지 표시. 실제 구현 시: `housing_posts` 컬렉션 + users 문서에 거주 단지 필드 + 팁 admin 편집 필요
- 미배포 (OTA 안 나감). `npx tsc --noEmit` 통과, iPhone 17 Pro 시뮬레이터 디버그 빌드로 검증

### 🔓 lunch_menus 공개 읽기 전환 (2026-07-24) — CI Tech Hub 위젯 연동
- `firestore.rules`에서 `lunch_menus` 컬렉션만 `allow read: if true`로 변경·배포 (쓰기는 여전히 차단, menuSync 함수만 Admin SDK로 씀)
- 이유: CI Tech Hub 데스크톱 앱(파이어베이스 로그인 없음)의 급식 위젯이 REST로 직접 읽게 하기 위함
- 연동 스펙 문서: `/Users/junyoung/OPENCLAW/LUNCH_WIDGET_HANDOFF.md`

### 🔥 캘린더 동기화 복구 (2026-07-27) — 6/8부터 조용히 전멸했던 것 수정
- **증상**: 홈 캘린더 위젯 빈 화면. `school_calendar`에 6/17 이후 이벤트 0건, lastSync 6/8에서 멈춤
- **원인 1 — Veracross API 강화**: v3가 `page` 쿼리 파라미터를 400으로 거부하게 바뀜 → 페이지네이션을 `X-Page-Number` 헤더로 변경
- **원인 2 — 시크릿 미등록**: 6/15 defineSecret 리팩토링 때 Secret Manager에 시크릿이 실제로 등록된 적 없었음(배포도 실패했던 것). 클라우드에 떠 있던 건 크레덴셜 하드코딩된 옛 버전. → `VERACROSS_CLIENT_ID`/`_SECRET` 등록 완료(2026-07-27 로테이션된 새 값)
- **원인 3 — 필드 매핑 오류**: 함수의 `mapEventToDocument`가 `event.title/name/summary`를 찾았지만 Veracross 응답엔 없음(제목은 `description`, 학교급은 `school_level_description`). 6월의 정상 데이터는 함수가 아니라 seed_calendar.mjs가 넣었던 것. → 시드 스크립트와 동일하게 매핑 수정
- **검증**: 수동 sync 성공(7~8월 25건, Constitution Day·New Faculty Orientation 등 제목/학교급 정상), 매시간 스케줄 재가동
- ⚠️ 교훈: 스케줄 함수 실패가 조용히 묻힘 — 실패 알림(에러 로그 기반) 추가 고려

### 🔥 AQI 위젯 복구 (2026-07-28) — data.go.kr 쿼터 초과
- **증상**: 홈 AQI 배너 "No data available". 원인: 앱이 클라이언트마다 공유 키로 AirKorea(data.go.kr)를 직접 호출하는 구조라 유저 증가로 무료 일일 쿼터(500회) 초과 → "API token quota exceeded"
- **구조 변경**: 신규 Cloud Function `aqiSync`(functions/src/aqiSync.ts)가 15분마다 서버에서 1회만 호출(96회/일)해 `app_config/aqi`에 캐시 → 위젯(WeatherAQIWidget)은 Firestore를 읽음. 클라이언트에서 data.go.kr 직접 호출 금지
- **폴백**: AirKorea 실패 시(쿼터/장애) Open-Meteo 대기질 API(키 불필요)에서 PM2.5/PM10 가져옴 (`source` 필드로 구분, 가스 수치는 단위 달라 0 처리)
- **배포**: 함수 배포 + 앱 JS는 OTA `eas update --channel production` (update group 3dc9320e, runtime 1.4.0 iOS/Android). 시뮬레이터 검증 완료 (27° Good, PM2.5 13/PM10 17)
- 참고: 날씨(기온)는 여전히 클라이언트에서 Open-Meteo 직접 호출 (키 불필요라 문제 없음)

### 📱 iPad 레이아웃 1차 개편 (2026-08-05) — 미배포 (로컬만)
- **신규**: `src/theme/responsive.ts` — `isTablet`(Platform.isPad), `screenPadding`(32/16), `gridColumns()`(3-4열), `centerContent(maxWidth)`(중앙정렬 no-op on phone), CONTENT_MAX_WIDTH=720, WIDE_MAX_WIDTH=1024
- **수정된 화면** (전부 isTablet 게이트, 폰 레이아웃 무변): HomeScreen(대시보드 중앙정렬), CommunityScreen(피드 720 중앙), MarketScreen(3-4열 그리드), LostFoundScreen(그리드+히어로 중앙), ChatListScreen/ChatRoomScreen(720 중앙, 버블 폭 조정), ProfileScreen/ProfileSubScreens(720 중앙)
- iPad Pro 11" 시뮬레이터 **세로+가로 모두 검증 완료** (Info.plist가 iPad는 원래 가로 허용 — 맥 "Designed for iPad" 실행도 같은 레이아웃). 가로: Home 1024 중앙+헤더 정렬(추가 수정), Market 4열, 피드/메시지 720 중앙. **아직 OTA/배포 안 나감** — 유저 승인 후 배포할 것
- 시뮬레이터 팁: iPhone 시뮬 앱 데이터 컨테이너를 iPad 시뮬로 rsync하면 로그인 세션 이전됨 (`simctl get_app_container <dev> com.chadwick.dolphin data` → Documents/ + Library/Application Support/ 복사)
- 남은 아이디어: 13" 검증, 가로모드(app.json orientation 변경=네이티브 리빌드 필요), Home 2컬럼 대시보드 심화

### 🔔 알림 진단 + 배포 (2026-08-05)
- **iPad 리디자인 OTA 배포됨** (update group 8251089f) + **알림 개선 OTA** (3da6d159)
- Market 알림 미수신 신고 조사: 서버는 정상 발송 중(8/4 매물 → 140명), 로직도 기본 켜짐(명시적 off만 제외, 현재 market off는 dcha 1명). **실제 구멍 = 215명 중 74명이 iOS 권한 거부로 pushToken 없음**
- `fanOutPush` 개선: Expo 티켓 검사(sent/failed/noToken 로그), DeviceNotRegistered 토큰 자동 삭제(다음 실행 시 재등록 유도) — 함수 배포됨
- `HomeScreen`에 "Notifications are off" 배너 추가: OS 권한 denied면 표시, Turn on → 설정 딥링크, X = 7일 스누즈, 포그라운드 복귀 시 재체크 — OTA 배포됨
- 진단 팁: 테스트 푸시는 exp.host push/send로 보내고 getReceipts로 영수증 확인 (jyyang 토큰 정상 전달 확인함)

### 🔴 구글플레이 거절 대응 (2026-08-06) — "로그인 정보가 잘못됨"
- **거절 사유**: Play 심사팀이 제공된 자격증명(`sd-innovationhub@chadwickschool.org` 학교 Google Workspace 계정)으로 로그인 실패. 앱이 Google 로그인 전용 + 학교 도메인 제한이라 심사관 기기에서 Workspace 보안/2SV에 막힘
- **해결책 = 심사 전용 Firebase 이메일 계정**:
  - Firebase Auth **Email/Password 프로바이더 활성화** (Identity Toolkit admin API PATCH)
  - 계정 `play.review@chadwickschool.org` / `Dolphin-Play-Review-2026` (uid `5M0RvuNTptZsoth5uKZnIF65s2I2`, emailVerified=true, `isReviewAccount:true`, Firestore 프로필 생성됨)
  - `LoginScreen.tsx`: **로고 1초 길게 누르면** "App review sign-in" 바텀시트 (이메일/비번). **일반 유저에게 보이는 버튼 없음** — 유저 요구사항. EULA 체크박스와 무관하게 동작, 에러 메시지 한글화 아닌 영어 매핑, KeyboardAvoidingView, Show 비번 토글
  - Play Console Sign in details 갱신 완료 + 안내문(457/500자)에 "PRESS AND HOLD the dolphin logo for 2 seconds" 명시
- **⚠️ 부수 보안 문제 발견/해결**: Email/Password 활성화 → 공개 웹 API 키로 **누구나 임의 계정 생성 가능** → `isAuth()`가 `request.auth != null`뿐이라 Firestore/Storage 전체 노출됨. **firestore.rules + storage.rules의 `isAuth()`를 "email_verified==true && @chadwickschool.org"로 강화**하고 배포. 실제 공격 경로로 검증(임의 가입 계정 → PERMISSION_DENIED, 심사 계정 → 정상). 기존 223계정 전원 emailVerified=true라 영향 없음(비도메인 gmail 8개는 원래 앱에서 차단됨)
- **OTA 먼저 배포한 이유**: production 채널 최신 OTA가 심사관 기기에서 embedded 번들을 덮어써 로그인 경로가 사라질 수 있음 → 리뷰어 로그인 포함 OTA(444fc2fc)를 AAB보다 먼저 publish
- **AAB**: `build-1785974594232.aab` (versionCode 12, v1.4.0). **업로드/제출은 유저가 수동** (브라우저 자동화 10MB 제한)
- 시뮬레이터 검증: 로고 길게누르기 → 모달 → 심사 계정 로그인 → 홈 진입 성공

---

*이 문서는 2026-06-11 22:09 작성, 2026-08-06 업데이트됨.*
