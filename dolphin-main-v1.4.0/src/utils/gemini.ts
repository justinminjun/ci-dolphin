import { getFunctions, httpsCallable } from 'firebase/functions';
import { getApp } from 'firebase/app';

export const MARKET_CATEGORIES = [
    'Electronics', 'Clothing', 'Shoes', 'Accessories', 'Books & Stationery',
    'Sports & Outdoors', 'Bags & Wallets', 'Home & Kitchen', 'Toys & Games',
    'Beauty & Health', 'Music & Instruments', 'Food & Drinks', 'Other',
] as const;

export const LOSTFOUND_CATEGORIES = [
    'Electronics', 'Clothing', 'Accessories', 'Stationery', 'Bag',
    'Sports', 'Books', 'Water Bottle', 'Keys', 'ID Card', 'Other',
] as const;

/**
 * Analyze a lost/found item image using Gemini AI.
 * The API key is stored server-side in Cloud Functions — never exposed to the client.
 *
 * Falls back to client-side call if Cloud Functions are not deployed yet.
 */
export const analyzeLostItemImage = async (base64Image: string) => {
    try {
        const functions = getFunctions(getApp());
        const analyzeImageFn = httpsCallable(functions, 'analyzeImage');
        const result = await analyzeImageFn({ base64Image });
        return result.data;
    } catch (error: any) {
        console.warn('Cloud Function not available, using fallback:', error.message);
        return analyzeLostItemImageFallback(base64Image);
    }
};

/**
 * Analyze market listing photos with AI to auto-generate title, description, category & tags.
 * Similar to Karrot/Danggeun Market's AI listing helper.
 * Supports 1-3 photos for better accuracy.
 */
export const analyzeMarketItemImages = async (base64Images: string[]): Promise<{
    title: string;
    description: string;
    category: string;
    tags: string[];
}> => {
    try {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
        if (!apiKey) throw new Error('Gemini API Key is missing.');

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: 'You MUST respond ONLY in English. Never use Korean, Japanese, Chinese, or any non-English language in your response. All titles, descriptions, tags, and every single word must be in English.',
        });

        const categories = MARKET_CATEGORIES.join(', ');
        const prompt = `You are an AI listing assistant for a school marketplace. Analyze these ${base64Images.length} photo(s) carefully.

IMPORTANT: Write EVERYTHING in English only. Only describe what you can ACTUALLY SEE in the photo. Do NOT make up specs, storage size, or details you cannot confirm from the image.

RULES:
1. **Title**: Exact product/model name if recognizable. Max 40 chars. Be specific.
2. **Description**: Write 1-2 casual sentences about the item first, then use bullet points (•) for visible key details. Use \\n for line breaks. Only mention details you can confirm from the photo — if you can see scratches, say so. If you can't tell the storage size, don't guess. Example: "Selling an iPhone 14 Pro in great shape.\\n\\n• Condition: Clean, minor wear on edges\\n• Color: Space Black\\n• Includes: Phone only"
3. **Category**: exactly one of: ${categories}
4. **Tags**: array of 4 English keywords — brand, model, condition, key feature.

Return a JSON object with keys: "title", "description", "category", "tags".
Only return the raw JSON object, no markdown, no code blocks.`;

        const imageParts = base64Images.map(img => ({
            inlineData: { data: img, mimeType: 'image/jpeg' as const },
        }));

        const result = await model.generateContent([prompt, ...imageParts]);
        const response = await result.response;
        const text = response.text();
        const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanedText);
    } catch (error: any) {
        console.error('Market AI analysis failed:', error);
        throw error;
    }
};

// ───────────────────────── Cuisine auto-classification ─────────────────────────
// Restaurants posted to Local Guide get their cuisine detected automatically:
// 1) deterministic mapping from Google Places types (free, instant)
// 2) Gemini text classification as fallback (handles Korean names like "신복관")

const CUISINE_KEYS = [
    'korean', 'bunsik', 'japanese', 'chinese', 'western', 'burger', 'pizza',
    'chicken', 'bbq', 'vietnamese', 'thai', 'indian', 'mexican', 'cafe',
    'vegetarian', 'fusion', 'other',
] as const;

const GOOGLE_TYPE_TO_CUISINE: Record<string, string> = {
    korean_restaurant: 'korean',
    korean_barbecue_restaurant: 'bbq',
    japanese_restaurant: 'japanese',
    sushi_restaurant: 'japanese',
    ramen_restaurant: 'japanese',
    chinese_restaurant: 'chinese',
    italian_restaurant: 'western',
    french_restaurant: 'western',
    spanish_restaurant: 'western',
    american_restaurant: 'western',
    steak_house: 'western',
    brunch_restaurant: 'western',
    breakfast_restaurant: 'western',
    hamburger_restaurant: 'burger',
    fast_food_restaurant: 'burger',
    sandwich_shop: 'burger',
    pizza_restaurant: 'pizza',
    barbecue_restaurant: 'bbq',
    vietnamese_restaurant: 'vietnamese',
    thai_restaurant: 'thai',
    indian_restaurant: 'indian',
    indonesian_restaurant: 'thai',
    mexican_restaurant: 'mexican',
    cafe: 'cafe',
    coffee_shop: 'cafe',
    bakery: 'cafe',
    dessert_shop: 'cafe',
    dessert_restaurant: 'cafe',
    ice_cream_shop: 'cafe',
    tea_house: 'cafe',
    juice_shop: 'cafe',
    donut_shop: 'cafe',
    bagel_shop: 'cafe',
    vegetarian_restaurant: 'vegetarian',
    vegan_restaurant: 'vegetarian',
};

export const classifyCuisine = async (input: {
    name: string;
    description?: string;
    address?: string;
    googleTypes?: string[];
}): Promise<string | null> => {
    // 1) Deterministic: Google Places types
    for (const t of input.googleTypes || []) {
        const mapped = GOOGLE_TYPE_TO_CUISINE[t];
        if (mapped) return mapped;
    }

    // 2) Gemini fallback — classify from name/description/address
    try {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
        if (!apiKey) return null;

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const prompt = `Classify this restaurant in Songdo, Incheon, South Korea into exactly ONE cuisine type.

Restaurant name: ${input.name}
${input.description ? `Description: ${input.description}` : ''}
${input.address ? `Address: ${input.address}` : ''}
${input.googleTypes?.length ? `Google Maps types: ${input.googleTypes.join(', ')}` : ''}

Allowed cuisine keys (pick exactly one):
- korean: Korean food (한식 — 국밥, 백반, 찌개, 고깃집 한정식 등)
- bunsik: Korean street food / snack bars (분식 — 떡볶이, 김밥, 라면, 순대)
- japanese: Japanese (일식 — 스시, 라멘, 돈카츠, 이자카야)
- chinese: Chinese (중식 — 짜장면, 마라탕, 양꼬치, 딤섬)
- western: Western (양식 — 파스타, 스테이크, 브런치, 이탈리안)
- burger: Burgers, sandwiches & fast food
- pizza: Pizza
- chicken: Korean fried chicken (치킨)
- bbq: BBQ & grill (고기구이, 삼겹살, 갈비, 곱창)
- vietnamese: Vietnamese (쌀국수, 분짜)
- thai: Thai & Southeast Asian
- indian: Indian (커리, 난)
- mexican: Mexican (타코, 부리토)
- cafe: Café, coffee, bakery & dessert
- vegetarian: Vegetarian / vegan
- fusion: Fusion
- other: Anything else / cannot determine

The name is often Korean — use it as the strongest signal (e.g. "~국밥" → korean, "~스시" → japanese, "~떡볶이" → bunsik, "~치킨" → chicken).
Respond with ONLY the cuisine key, nothing else.`;

        const result = await model.generateContent(prompt);
        // Take the first word only — the model occasionally appends "(한식)" etc.
        const text = (await result.response).text().trim().toLowerCase()
            .split(/[\s(]/)[0].replace(/[^a-z]/g, '');
        return (CUISINE_KEYS as readonly string[]).includes(text) ? text : null;
    } catch {
        return null;
    }
};

/**
 * TEMPORARY FALLBACK — Remove after deploying Cloud Functions.
 */
async function analyzeLostItemImageFallback(base64Image: string) {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');

    const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
    if (!apiKey) throw new Error('Gemini API Key is missing.');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `You are an AI assistant for a school's Lost & Found app. Analyze this image of a lost or found item.

Return a JSON object with strictly these keys:
- "title": a short, clear name for the item (e.g. "MacBook Pro Laptop")
- "description": a brief but detailed visual description (2-3 sentences)
- "color": primary color of the item
- "brand": any recognizable brand, or empty string
- "category": one of: ${LOSTFOUND_CATEGORIES.join(', ')}
- "tags": an array of exactly 4 hashtag-style feature keywords (without the # symbol).

Only return the raw JSON object, no markdown formatting, no code blocks.`;

    const result = await model.generateContent([
        prompt,
        { inlineData: { data: base64Image, mimeType: 'image/jpeg' } },
    ]);
    const response = await result.response;
    const text = response.text();
    const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanedText);
}
