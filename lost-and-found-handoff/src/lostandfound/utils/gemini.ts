import { GoogleGenerativeAI } from '@google/generative-ai';
import { LOSTFOUND_CATEGORIES } from './constants';

const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
const genAI = new GoogleGenerativeAI(apiKey);

export const analyzeLostItemImage = async (base64Image: string, mimeType = 'image/jpeg') => {
    if (!apiKey) {
        throw new Error('Gemini API Key is missing. Please add it to your environment variables.');
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `You are an AI assistant for a school's Lost & Found app. Analyze this image of a lost or found item.

Return a JSON object with strictly these keys:
- "title": a short, clear name for the item (e.g. "MacBook Pro Laptop")
- "description": a brief but detailed visual description (2-3 sentences)
- "color": primary color of the item
- "brand": any recognizable brand, or empty string
- "category": one of: ${LOSTFOUND_CATEGORIES.join(', ')}
- "tags": an array of exactly 4 hashtag-style feature keywords (without the # symbol). These should describe key visual features, material, or distinguishing marks. Examples: ["silver", "Apple logo", "13-inch", "sticker on lid"]

Only return the raw JSON object, no markdown formatting, no code blocks.`;

    const imageParts = [
        {
            inlineData: {
                data: base64Image,
                mimeType
            }
        }
    ];

    try {
        const result = await model.generateContent([prompt, ...imageParts]);
        const response = await result.response;
        const text = response.text();

        // Clean up potential markdown formatting block from the response
        const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanedText);
    } catch (error) {
        console.error('Gemini API Error:', error);
        throw error;
    }
};
