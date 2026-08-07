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
