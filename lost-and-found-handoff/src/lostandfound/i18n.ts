import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Lightweight EN/KO switch scoped to the Lost & Found screens only.
// Stored data (zones, categories, drop-off spots) always stays in English;
// only display labels are translated.

export type LFLang = 'en' | 'ko';

const EN = {
    // Feed
    lostAndFound: 'Lost & Found',
    filterAll: 'All',
    filterLost: 'Lost',
    filterFound: 'Found',
    filterResolved: 'Resolved',
    allCategories: 'All items',
    anyLocation: 'Any location',
    taglineTop: 'Lost something?',
    taglineBottom: 'Find it on Dolphin.',
    searchPlaceholder: 'Search by name, location, color, or tag...',
    clearSearch: 'Clear search',
    itemCountOne: '{n} item',
    itemCountMany: '{n} items',
    sortBy: 'Sort',
    sortNewest: 'Newest',
    sortOldest: 'Oldest',
    sortEventDate: 'Date lost/found',
    noResults: 'No results found',
    tryDifferent: 'Try a different search or filter.',
    nothingPosted: 'Nothing posted yet',
    tapToReport: 'Tap Post to report a lost or found item!',
    post: 'Post',
    postA11y: 'Report a lost or found item',
    showOlder: 'Show {n} older posts',
    hideOlder: 'Hide older posts',
    olderNote: 'Posts with no activity for {d}+ days',
    olderBadge: 'Older',
    unknownLocation: 'Unknown location',
    badgeLost: 'Lost',
    badgeFound: 'Found',
    resolvedBadge: '✓ Resolved',
    photosCount: '{n} photos',
    withFinderBadge: 'With finder',
    roleStudent: 'Student',
    roleFaculty: 'Faculty / Staff',
    notifications: 'Notifications',
    switchLanguage: 'Switch language to Korean',
    justNow: 'Just now',
    minutesAgo: '{n}m ago',
    hoursAgo: '{n}h ago',
    daysAgo: '{n}d ago',
    cardA11y: '{type}: {title}, {location}',

    // Add / edit post
    newReport: 'New Report',
    close: 'Close',
    foundThis: 'I Found This',
    lostThis: 'I Lost This',
    lockedFound: '✅  Found an Item',
    lockedLost: '🚨  Report Lost Item',
    photos: 'Photos',
    addPhoto: 'Add Photo',
    addMore: 'Add More',
    cameraOrGallery: 'Camera or Gallery',
    uploadFromDevice: 'Upload from device',
    photoHint: 'Tap to take a photo or choose from gallery. AI will auto-analyze the first image.',
    photoHintWeb: 'Click to upload a photo. AI will auto-analyze the first image.',
    mainPhoto: 'Main',
    analyzing: 'AI is analyzing the image...',
    aiTags: 'AI Tags',
    itemTitle: 'Item Title',
    titlePlaceholder: 'e.g. AirPods Pro',
    category: 'Category',
    description: 'Description',
    descPlaceholder: 'Describe the item...',
    color: 'Color',
    colorPlaceholder: 'e.g. Navy blue',
    whereFound: 'Where was it found?',
    whereLost: 'Where was it lost?',
    customZonePlaceholder: 'Name the area, e.g. Front Garden',
    detailPlaceholder: 'Specific spot (optional) — e.g. 2nd floor, near room 204',
    whereNow: "Where's the item now?",
    droppedOff: '📍 I dropped it off',
    holding: "🤝 I'm holding it",
    whereDropped: 'Where did you drop it off?',
    other: 'Other',
    dropOffPlaceholder: 'Where exactly? e.g. Cafeteria counter',
    holdingHint: "Other users will see that you're personally holding this item, and can message you to arrange a hand-off.",
    whenFound: 'When did you find it?',
    whenLost: 'When did you lose it?',
    timeUnknownParen: '(Time unknown)',
    date: 'Date',
    today: 'Today',
    time: 'Time',
    timeIsUnknown: 'Time is unknown',
    dontKnowTime: "I don't know the time",
    done: 'Done',
    postItem: 'Post Item',
    saveChanges: 'Save Changes',
    missingInfo: 'Missing Info',
    needPhotoTitle: 'Please provide at least one photo and a title.',
    needZone: 'Please select where this happened.',
    needFoundStatus: "Please let others know whether you dropped the item off or you're still holding onto it.",
    needDropOff: 'Please specify where you dropped it off.',
    maxPhotosTitle: 'Maximum Photos',
    maxPhotosBody: 'You can add up to {n} photos.',
    cameraPermTitle: 'Camera Permission',
    cameraPermBody: 'Camera access is needed to take photos. Please enable it in Settings.',
    aiNoteTitle: 'AI Analysis Note',
    aiNoteBody: 'AI could not analyze. You can enter details manually.',
    updatedTitle: 'Updated!',
    updatedBody: 'Your report has been updated.',
    successTitle: 'Success!',
    successBody: 'Your item has been posted successfully.',
    successMatches: 'We found {n} possible match(es) — check the post for details.',
    errorTitle: 'Error',
    postFailed: 'Failed to post item.',
    addPhotoTitle: 'Add Photo',
    photosAdded: '{n}/{max} photos added',
    takePhoto: 'Take Photo',
    chooseGallery: 'Choose from Gallery',
    cancel: 'Cancel',
    removePhoto: 'Remove photo {n}',
    removeTag: 'Remove tag {tag}',
    hourUp: 'Hour up',
    hourDown: 'Hour down',
    minuteUp: 'Minute up',
    minuteDown: 'Minute down',
    toggleAmPm: 'Switch AM/PM',

    // Detail
    goBack: 'Go back',
    managePost: 'Manage Post',
    location: 'Location',
    notSpecified: 'Not specified',
    itemStatus: 'Item status',
    finderHolding: '🤝 Finder is holding this item',
    messageToArrange: 'Message {name} to arrange a hand-off.',
    theFinder: 'the finder',
    droppedOffAt: 'Dropped off at',
    dateLost: 'Date Lost',
    dateFound: 'Date Found',
    noDescription: 'No description provided.',
    possibleMatches: 'Possible matches',
    possibleMatchesForLost: 'Found items that look similar to this one',
    possibleMatchesForFound: 'Lost reports that look similar to this item',
    staleTitle: 'This post is over {d} days old',
    staleBody: 'Still looking? Bump it back to the top of the feed, or mark it resolved.',
    bump: 'Bump to top',
    bumpedTitle: 'Bumped!',
    bumpedBody: 'Your post is back at the top of the feed.',
    reopenPost: 'Reopen Post',
    markResolved: 'Mark as Resolved',
    reopenConfirm: 'Reopen this post?',
    resolveConfirm: 'Has the item been returned? Mark as resolved.',
    reopen: 'Reopen',
    resolve: 'Resolve',
    messageOwner: 'Message Owner',
    messageFinder: 'Message Finder',
    signInToMessage: 'Please sign in with your school account to send messages.',
    editReport: 'Edit Report',
    deletePost: 'Delete Post',
    deleteReportTitle: 'Delete Report',
    deleteConfirm: 'Are you sure you want to delete this post?',
    delete: 'Delete',
    deleteFailed: 'Failed to delete.',
    updateFailed: 'Failed to update: {msg}',
    closePhoto: 'Close photo',
    viewPhoto: 'View photo {n} of {total}',
};

type Key = keyof typeof EN;

const KO: Record<Key, string> = {
    lostAndFound: '분실물 센터',
    filterAll: '전체',
    filterLost: '분실',
    filterFound: '습득',
    filterResolved: '해결됨',
    allCategories: '모든 물건',
    anyLocation: '모든 위치',
    taglineTop: '물건을 잃어버리셨나요?',
    taglineBottom: 'Dolphin에서 찾아보세요.',
    searchPlaceholder: '이름, 위치, 색상, 태그로 검색...',
    clearSearch: '검색어 지우기',
    itemCountOne: '{n}개',
    itemCountMany: '{n}개',
    sortBy: '정렬',
    sortNewest: '최신순',
    sortOldest: '오래된순',
    sortEventDate: '분실·습득일순',
    noResults: '검색 결과가 없어요',
    tryDifferent: '다른 검색어나 필터를 사용해 보세요.',
    nothingPosted: '아직 게시물이 없어요',
    tapToReport: '등록 버튼을 눌러 분실물·습득물을 올려보세요!',
    post: '등록',
    postA11y: '분실물 또는 습득물 등록하기',
    showOlder: '오래된 게시물 {n}개 보기',
    hideOlder: '오래된 게시물 숨기기',
    olderNote: '{d}일 이상 활동이 없는 게시물',
    olderBadge: '오래됨',
    unknownLocation: '위치 미상',
    badgeLost: '분실',
    badgeFound: '습득',
    resolvedBadge: '✓ 해결됨',
    photosCount: '사진 {n}장',
    withFinderBadge: '습득자 보관',
    roleStudent: '학생',
    roleFaculty: '교직원',
    notifications: '알림',
    switchLanguage: 'Switch language to English',
    justNow: '방금',
    minutesAgo: '{n}분 전',
    hoursAgo: '{n}시간 전',
    daysAgo: '{n}일 전',
    cardA11y: '{type}: {title}, {location}',

    newReport: '새 게시물',
    close: '닫기',
    foundThis: '습득했어요',
    lostThis: '잃어버렸어요',
    lockedFound: '✅  습득물 등록',
    lockedLost: '🚨  분실물 신고',
    photos: '사진',
    addPhoto: '사진 추가',
    addMore: '더 추가',
    cameraOrGallery: '카메라 또는 앨범',
    uploadFromDevice: '기기에서 업로드',
    photoHint: '사진을 찍거나 앨범에서 선택하세요. 첫 번째 사진은 AI가 자동 분석해요.',
    photoHintWeb: '클릭해서 사진을 올리세요. 첫 번째 사진은 AI가 자동 분석해요.',
    mainPhoto: '대표',
    analyzing: 'AI가 사진을 분석하고 있어요...',
    aiTags: 'AI 태그',
    itemTitle: '물건 이름',
    titlePlaceholder: '예: 에어팟 프로',
    category: '종류',
    description: '설명',
    descPlaceholder: '물건의 특징을 적어주세요...',
    color: '색상',
    colorPlaceholder: '예: 남색',
    whereFound: '어디서 주웠나요?',
    whereLost: '어디서 잃어버렸나요?',
    customZonePlaceholder: '장소 이름 (예: 앞마당)',
    detailPlaceholder: '구체적인 위치 (선택) — 예: 2층 204호 근처',
    whereNow: '물건은 지금 어디 있나요?',
    droppedOff: '📍 맡겨뒀어요',
    holding: '🤝 제가 갖고 있어요',
    whereDropped: '어디에 맡겼나요?',
    other: '기타',
    dropOffPlaceholder: '정확히 어디인가요? 예: 식당 카운터',
    holdingHint: '다른 사용자에게 회원님이 직접 보관 중이라고 표시되고, 메시지로 전달 방법을 정할 수 있어요.',
    whenFound: '언제 주웠나요?',
    whenLost: '언제 잃어버렸나요?',
    timeUnknownParen: '(시간 모름)',
    date: '날짜',
    today: '오늘',
    time: '시간',
    timeIsUnknown: '시간 모름',
    dontKnowTime: '시간을 모르겠어요',
    done: '완료',
    postItem: '등록하기',
    saveChanges: '저장하기',
    missingInfo: '정보를 입력해 주세요',
    needPhotoTitle: '사진 1장 이상과 물건 이름을 입력해 주세요.',
    needZone: '위치를 선택해 주세요.',
    needFoundStatus: '물건을 어딘가에 맡겼는지, 직접 갖고 있는지 선택해 주세요.',
    needDropOff: '어디에 맡겼는지 선택해 주세요.',
    maxPhotosTitle: '사진 개수 초과',
    maxPhotosBody: '사진은 최대 {n}장까지 올릴 수 있어요.',
    cameraPermTitle: '카메라 권한',
    cameraPermBody: '사진을 찍으려면 카메라 권한이 필요해요. 설정에서 허용해 주세요.',
    aiNoteTitle: 'AI 분석 안내',
    aiNoteBody: 'AI 분석에 실패했어요. 직접 입력해 주세요.',
    updatedTitle: '수정 완료!',
    updatedBody: '게시물이 수정되었어요.',
    successTitle: '등록 완료!',
    successBody: '게시물이 등록되었어요.',
    successMatches: '비슷한 물건 {n}개를 찾았어요 — 게시물에서 확인해 보세요.',
    errorTitle: '오류',
    postFailed: '등록에 실패했어요.',
    addPhotoTitle: '사진 추가',
    photosAdded: '{n}/{max}장 추가됨',
    takePhoto: '사진 찍기',
    chooseGallery: '앨범에서 선택',
    cancel: '취소',
    removePhoto: '사진 {n} 삭제',
    removeTag: '태그 {tag} 삭제',
    hourUp: '시 올리기',
    hourDown: '시 내리기',
    minuteUp: '분 올리기',
    minuteDown: '분 내리기',
    toggleAmPm: '오전/오후 전환',

    goBack: '뒤로 가기',
    managePost: '게시물 관리',
    location: '위치',
    notSpecified: '미입력',
    itemStatus: '물건 상태',
    finderHolding: '🤝 습득자가 보관 중이에요',
    messageToArrange: '{name}님에게 메시지를 보내 전달 방법을 정하세요.',
    theFinder: '습득자',
    droppedOffAt: '맡긴 곳',
    dateLost: '분실 날짜',
    dateFound: '습득 날짜',
    noDescription: '설명이 없어요.',
    possibleMatches: '비슷한 물건',
    possibleMatchesForLost: '이 물건과 비슷해 보이는 습득물',
    possibleMatchesForFound: '이 물건과 비슷해 보이는 분실 신고',
    staleTitle: '{d}일 넘게 지난 게시물이에요',
    staleBody: '아직 찾고 있나요? 피드 맨 위로 다시 올리거나 해결됨으로 표시하세요.',
    bump: '맨 위로 올리기',
    bumpedTitle: '올렸어요!',
    bumpedBody: '게시물이 피드 맨 위로 올라갔어요.',
    reopenPost: '다시 열기',
    markResolved: '해결됨으로 표시',
    reopenConfirm: '게시물을 다시 열까요?',
    resolveConfirm: '물건이 주인에게 돌아갔나요? 해결됨으로 표시할게요.',
    reopen: '다시 열기',
    resolve: '해결',
    messageOwner: '주인에게 메시지',
    messageFinder: '습득자에게 메시지',
    signInToMessage: '메시지를 보내려면 학교 계정으로 로그인해 주세요.',
    editReport: '게시물 수정',
    deletePost: '게시물 삭제',
    deleteReportTitle: '게시물 삭제',
    deleteConfirm: '이 게시물을 정말 삭제할까요?',
    delete: '삭제',
    deleteFailed: '삭제에 실패했어요.',
    updateFailed: '업데이트 실패: {msg}',
    closePhoto: '사진 닫기',
    viewPhoto: '사진 {n}/{total} 크게 보기',
};

const ZONE_KO: Record<string, string> = {
    'Lower School': '초등부 (LS)',
    'Middle School': '중등부 (MS)',
    'Upper School': '고등부 (US)',
    'Library': '도서관',
    'Cafeteria': '식당',
    'Gym / Athletic Center': '체육관',
    'Auditorium': '강당',
    'Main Office': '행정실',
    'Bus / Pick-up Area': '버스·픽업 구역',
    'Outdoor / Field': '야외·운동장',
    'Parking Lot': '주차장',
    'Other': '기타',
};

const CATEGORY_KO: Record<string, string> = {
    'Electronics': '전자기기',
    'Clothing': '의류',
    'Accessories': '액세서리',
    'Stationery': '문구류',
    'Bag': '가방',
    'Sports': '운동용품',
    'Books': '책',
    'Water Bottle': '물병',
    'Keys': '열쇠',
    'ID Card': 'ID 카드',
    'Other': '기타',
};

const DROPOFF_KO: Record<string, string> = {
    'MS Office': '중등부 사무실 (MS Office)',
    'US Office': '고등부 사무실 (US Office)',
};

const STORAGE_KEY = 'lf_lang';
let current: LFLang = 'en';
let loaded = false;
const listeners = new Set<(l: LFLang) => void>();

function apply(l: LFLang) {
    current = l;
    listeners.forEach(fn => fn(l));
}

export function setLFLang(l: LFLang) {
    apply(l);
    AsyncStorage.setItem(STORAGE_KEY, l).catch(() => {});
}

function format(str: string, vars?: Record<string, string | number>) {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function useLFLang() {
    const [lang, setLang] = useState<LFLang>(current);

    useEffect(() => {
        listeners.add(setLang);
        if (!loaded) {
            loaded = true;
            AsyncStorage.getItem(STORAGE_KEY)
                .then(v => { if ((v === 'en' || v === 'ko') && v !== current) apply(v); })
                .catch(() => {});
        }
        return () => { listeners.delete(setLang); };
    }, []);

    const ko = lang === 'ko';
    const t = (key: Key, vars?: Record<string, string | number>) => format((ko ? KO : EN)[key], vars);
    const zoneLabel = (z: string) => (ko && ZONE_KO[z]) || z;
    const categoryLabel = (c: string) => (ko && CATEGORY_KO[c]) || c;
    const dropOffLabel = (d: string) => (ko && DROPOFF_KO[d]) || d;
    const locale = ko ? 'ko-KR' : 'en-US';

    const timeAgo = (ts: any) => {
        if (!ts) return t('justNow');
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        const s = Math.floor((Date.now() - d.getTime()) / 1000);
        if (s < 60) return t('justNow');
        if (s < 3600) return t('minutesAgo', { n: Math.floor(s / 60) });
        if (s < 86400) return t('hoursAgo', { n: Math.floor(s / 3600) });
        return t('daysAgo', { n: Math.floor(s / 86400) });
    };

    return { lang, setLang: setLFLang, t, zoneLabel, categoryLabel, dropOffLabel, locale, timeAgo };
}
