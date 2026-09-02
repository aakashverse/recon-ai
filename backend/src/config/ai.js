import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

let currentApiKey = process.env.GEMINI_API_KEY || '';
let genAI = null;
let geminiModel = null;
let textGenModel = null;
let embeddingModel = null;

const candidateModels = ['gemini-flash-lite-latest', 'gemini-1.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];
let activeModelName = 'gemini-flash-lite-latest';
const activeEmbeddingModelName = 'gemini-embedding-001';

export function initGemini(apiKey = currentApiKey) {
  if (apiKey && apiKey !== 'your_gemini_api_key_here' && apiKey.trim().length > 10) {
    try {
      currentApiKey = apiKey.trim();
      genAI = new GoogleGenerativeAI(currentApiKey);
      activeModelName = 'gemini-flash-lite-latest';

      // JSON Model for structured extraction
      geminiModel = genAI.getGenerativeModel({
        model: activeModelName,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      // Text Model for dynamic reasoning & dispute drafting
      textGenModel = genAI.getGenerativeModel({
        model: activeModelName,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      });

      // Dense Embedding Model for True Semantic Vector RAG (3072 dimensions)
      embeddingModel = genAI.getGenerativeModel({
        model: activeEmbeddingModelName,
      });

      console.log(`[AI Engine] Google Gemini (${activeModelName}) & Embeddings (${activeEmbeddingModelName}) initialized successfully.`);
      return true;
    } catch (err) {
      console.warn('[AI Engine] Failed to initialize Gemini API:', err.message);
      return false;
    }
  } else {
    console.log('[AI Engine] Operating in High-Resilience Intelligent Mode (Built-in Heuristic & Template Engine). Add GEMINI_API_KEY in .env or via UI for live Gemini Flash calls.');
    return false;
  }
}

// Initial bootstrap
initGemini(currentApiKey);

export function getGeminiModel() {
  return geminiModel;
}

export function getTextGenModel() {
  return textGenModel;
}

export function getEmbeddingModel() {
  return embeddingModel;
}

export function isAIAvailable() {
  return Boolean(geminiModel);
}

export function getGenAI() {
  return genAI;
}

export function getActiveModelName() {
  return activeModelName;
}

export function getApiKeyStatus() {
  return {
    isConfigured: isAIAvailable(),
    hasKey: Boolean(currentApiKey && currentApiKey !== 'your_gemini_api_key_here'),
    keyMasked: currentApiKey ? `${currentApiKey.slice(0, 6)}...${currentApiKey.slice(-4)}` : null,
    modelName: activeModelName,
    freeTierInfo: 'Google AI Studio Free Tier supports 15 Requests/Min & 1,500 Requests/Day with 0 cost.',
  };
}
