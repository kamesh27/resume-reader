import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import fs from 'fs/promises'; // Use promises version for async operations
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import multer from 'multer';
// Import pdfjs-dist components
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'; // Correct path to .mjs file
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'; // Added for PDF generation
import fsSync from 'fs'; // Use sync version only for startup checks/renames
import { fileURLToPath, pathToFileURL } from 'url'; // Needed for __dirname and main module check

// Load environment variables from .env file
dotenv.config();

// --- File Upload Setup ---
// Define as functions to potentially avoid initialization issues in Jest/Babel environment
const getFilename = () => fileURLToPath(import.meta.url);
const getDirname = () => path.dirname(getFilename());

// JD Uploads
// Use the functions to get the values
const jdUploadDir = path.join(getDirname(), 'uploads/jds');
// Ensure JD upload directory exists
if (!fsSync.existsSync(jdUploadDir)) {
    try {
        fsSync.mkdirSync(jdUploadDir, { recursive: true });
        console.log(`Created JD upload directory: ${jdUploadDir}`);
    } catch (mkdirError) {
        console.error(`FATAL: Could not create JD upload directory ${jdUploadDir}`, mkdirError);
        process.exit(1);
    }
}

// Resume Uploads
const resumeUploadDir = path.join(getDirname(), 'uploads/resumes'); // Use getDirname()
// Ensure Resume upload directory exists
if (!fsSync.existsSync(resumeUploadDir)) {
    try {
        fsSync.mkdirSync(resumeUploadDir, { recursive: true });
        console.log(`Created Resume upload directory: ${resumeUploadDir}`);
    } catch (mkdirError) {
        console.error(`FATAL: Could not create Resume upload directory ${resumeUploadDir}`, mkdirError);
        process.exit(1);
    }
}


// Filter for PDF files (reusable)
const pdfFileFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
        cb(null, true); // Accept the file
    } else {
        // Reject the file
        cb(new Error('Upload failed: Only PDF files are allowed!'), false);
    }
};

// Multer storage for JDs - save with a temporary name first
const jdStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, jdUploadDir);
    },
    filename: function (req, file, cb) {
        // Temporary filename, will be renamed in the route handler
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'temp-jd-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const jdUpload = multer({
    storage: jdStorage,
    fileFilter: pdfFileFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit for JDs
});

// Multer storage for Resumes - save with a temporary name first
const resumeStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, resumeUploadDir);
    },
    filename: function (req, file, cb) {
        // Temporary filename, will be processed and likely deleted
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'temp-resume-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const resumeUpload = multer({
    storage: resumeStorage,
    fileFilter: pdfFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit for Resumes
});

// --- Data Persistence Setup ---
const dataFilePath = path.join(getDirname(), 'data.json'); // Use getDirname()

async function readData() {
    try {
        const rawData = await fs.readFile(dataFilePath, 'utf-8');
        return JSON.parse(rawData);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('Data file not found, initializing with default structure.');
            return { roles: {}, jds: {} }; // Return default structure if not found
        }
        console.error('Error reading data file:', error);
        // Re-throw unexpected errors so route handlers can return 500
        throw new Error(`Could not read data file: ${error.message}`);
    }
}

async function writeData(data) {
    try {
        await fs.writeFile(dataFilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
        console.error('Error writing data file:', error);
        // Decide if this should be fatal or just logged
        throw new Error('Could not write data file.');
    }
}

const app = express();
const port = process.env.PORT || 3001;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- Gemini AI Setup ---
const API_KEY = process.env.GOOGLE_API_KEY;
if (!API_KEY) {
    console.error("FATAL ERROR: GOOGLE_API_KEY is not defined in the .env file.");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash-latest",
});

const generationConfig = {
    temperature: 0.7, // Slightly lower temp for more factual analysis
    topK: 1,
    topP: 1,
    maxOutputTokens: 4096, // Increase if needed for long JDs
};
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

// --- Resume Suggestion Endpoint (Original Feature - Kept for potential other uses) ---
app.post('/api/suggest', async (req, res) => {
    const { point } = req.body;
    if (!point || typeof point !== 'string' || point.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid or missing "point" in request body.' });
    }
    console.log(`Received suggestion request for point: "${point}"`);
    const prompt = `Rewrite the following resume bullet point 3 different ways using the STAR (Situation-Task-Action-Result) or CAR (Challenge-Action-Result) method: "${point}"\n\nFocus on:\n* Starting with strong action verbs.\n* Quantifying achievements whenever possible (e.g., increased sales by 15%, reduced errors by 25%).\n* Highlighting the impact of the actions taken.\n* Keeping each rewritten point concise and impactful.\n\nProvide only the 3 rewritten bullet points, each on a new line. Do not include introductory phrases like "Here are the suggestions:" or the original point.\nExample of one rewritten point: "Led a team of 5 engineers to develop a new feature, resulting in a 10% increase in user engagement."`;
    try {
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig,
            safetySettings,
        });
        if (!result.response.candidates || result.response.candidates.length === 0) {
            const blockReason = result.response.promptFeedback?.blockReason;
            console.warn(`Suggest request blocked. Reason: ${blockReason || 'Unknown'}`);
            return res.status(500).json({ error: `Request blocked by safety settings: ${blockReason || 'No candidates returned'}` });
        }
        const responseText = result.response.text();
        if (!responseText || responseText.trim().length === 0) {
            console.warn("Suggest API returned empty text content for:", point);
            return res.status(500).json({ error: 'API returned empty content.' });
        }
        const suggestions = responseText.split('\n').map(s => s.trim()).filter(s => s.length > 0).slice(0, 3);
        console.log(`Sending suggestions for "${point}":`, suggestions);
        res.json({ suggestions });
    } catch (error) {
        console.error(`Error calling Gemini API for suggest point "${point}":`, error);
        res.status(500).json({ error: `Gemini API request failed: ${error.message || 'Unknown server error'}` });
    }
});


// --- NEW JD Analysis Endpoints ---

// Create a new Role
app.post('/api/roles', async (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Role name is required.' });
    }
    try {
        const data = await readData();
        const newRoleId = uuidv4();
        const newRole = {
            id: newRoleId,
            name: name.trim(),
            jdIds: [],
            createdAt: new Date().toISOString(),
        };
        // Ensure roles object exists
        if (!data.roles) data.roles = {};
        data.roles[newRoleId] = newRole;
        await writeData(data);
        console.log(`Created role: ${newRole.name} (ID: ${newRoleId})`);
        res.status(201).json(newRole);
    } catch (error) {
        console.error('Error creating role:', error);
        res.status(500).json({ error: 'Failed to create role.' });
    }
});

// Get all Roles
app.get('/api/roles', async (req, res) => {
    try {
        const data = await readData();
        const rolesArray = Object.values(data.roles || {});
        res.json(rolesArray);
    } catch (error) {
        console.error('Error getting roles:', error);
        res.status(500).json({ error: 'Failed to retrieve roles.' });
    }
});

// Helper function to crudely strip HTML tags
function stripHtml(html) {
    if (!html || typeof html !== 'string') return '';
    let cleaned = html.replace(/<script[^>]*>([\S\s]*?)<\/script>/gmi, '');
    cleaned = cleaned.replace(/<style[^>]*>([\S\s]*?)<\/style>/gmi, '');
    cleaned = cleaned.replace(/<[^>]+>/g, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
}

// Add a JD URL to a specific Role
app.post('/api/roles/:roleId/jds/url', async (req, res) => {
    const { roleId } = req.params;
    const { url } = req.body;
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
        return res.status(400).json({ error: 'Valid URL is required.' });
    }
    try {
        const data = await readData();
        if (!data.roles || !data.roles[roleId]) {
            return res.status(404).json({ error: 'Role not found.' });
        }
        const newJdId = uuidv4();
        const newJd = {
            id: newJdId, roleId: roleId, type: 'url', source: url.trim(),
            status: 'pending', analysis: null, keywords: [], createdAt: new Date().toISOString(), error: null,
        };
        if (!data.jds) data.jds = {};
        data.jds[newJdId] = newJd;
        if (!data.roles[roleId].jdIds) data.roles[roleId].jdIds = [];
        data.roles[roleId].jdIds.push(newJdId);
        await writeData(data);
        console.log(`Added JD URL "${newJd.source}" to role ${roleId} (JD ID: ${newJdId})`);
        res.status(201).json(newJd);
    } catch (error) {
        console.error(`Error adding JD URL for role ${roleId}:`, error);
        res.status(500).json({ error: 'Failed to add JD URL.' });
    }
});

// Add a JD PDF Upload to a specific Role
app.post('/api/roles/:roleId/jds/upload', (req, res, next) => {
    // Wrap multer upload in a function to handle its errors specifically
    const uploader = jdUpload.single('jdPdf'); // Use jdUpload instance
    uploader(req, res, async (uploadError) => {
        if (uploadError) {
            // Handle Multer errors (file size, filter, etc.)
            console.error("Multer upload error:", uploadError);
            if (uploadError instanceof multer.MulterError) {
                return res.status(400).json({ error: `File upload error: ${uploadError.message}` });
            } else {
                // Handle filter errors (e.g., wrong file type from pdfFileFilter)
                 return res.status(400).json({ error: uploadError.message || 'File upload failed.' });
            }
        }
        // If upload is successful, proceed with the rest of the logic
        next();
    });
}, async (req, res) => {
    // This part runs only if upload.single('jdPdf') succeeds without error
    const { roleId } = req.params;
    if (!req.file) {
        // This case should ideally be caught by Multer, but check again
        return res.status(400).json({ error: 'No PDF file uploaded or file rejected.' });
    }

    const tempFilePath = req.file.path;
    const originalFilename = req.file.originalname;
    const newJdId = uuidv4(); // Generate ID before DB operations
    const finalFilename = `${newJdId}.pdf`;
    const finalFilePath = path.join(jdUploadDir, finalFilename); // Use jdUploadDir

    try {
        const data = await readData();
        if (!data.roles || !data.roles[roleId]) {
            await fs.unlink(tempFilePath).catch(err => console.error("Cleanup Error: Failed to delete temp file for non-existent role:", err));
            return res.status(404).json({ error: 'Role not found.' });
        }

        // Rename the uploaded file synchronously (atomic operation preferred)
        fsSync.renameSync(tempFilePath, finalFilePath);
        console.log(`Renamed uploaded file to ${finalFilename}`);

        const newJd = {
            id: newJdId, roleId: roleId, type: 'pdf', source: finalFilename, originalFilename: originalFilename,
            status: 'pending', analysis: null, keywords: [], createdAt: new Date().toISOString(), error: null,
        };

        if (!data.jds) data.jds = {};
        data.jds[newJdId] = newJd;
        if (!data.roles[roleId].jdIds) data.roles[roleId].jdIds = [];
        data.roles[roleId].jdIds.push(newJdId);

        await writeData(data);
        console.log(`Added JD PDF "${originalFilename}" to role ${roleId} (JD ID: ${newJdId}, Saved as: ${finalFilename})`);
        res.status(201).json(newJd);

    } catch (error) {
        console.error(`Error processing uploaded PDF for role ${roleId}:`, error);
        // Clean up potentially renamed file if DB write fails
        if (fsSync.existsSync(finalFilePath)) {
            await fs.unlink(finalFilePath).catch(err => console.error("Cleanup Error: Failed to delete final file after DB error:", err));
        }
        // Also ensure temp file is gone if rename failed but file exists
        else if (fsSync.existsSync(tempFilePath)) {
             await fs.unlink(tempFilePath).catch(err => console.error("Cleanup Error: Failed to delete temp file after processing error:", err));
        }
        res.status(500).json({ error: error.message || 'Failed to process uploaded JD PDF.' });
    }
});


// Trigger analysis for a specific JD
app.post('/api/jds/:jdId/analyze', async (req, res) => {
    const { jdId } = req.params;
    try {
        let data = await readData();
        const jd = data.jds?.[jdId]; // Use optional chaining

        if (!jd) {
            return res.status(404).json({ error: 'JD not found.' });
        }
        if (jd.status === 'processing' || jd.status === 'completed') {
            console.log(`JD ${jdId} is already ${jd.status}. Skipping analysis.`);
            return res.status(200).json({ message: `JD analysis already ${jd.status}.`, jd });
        }

        // Mark as processing and save *before* starting async task
        jd.status = 'processing';
        jd.error = null;
        await writeData(data);
        console.log(`Starting analysis for JD ${jdId} (Type: ${jd.type}, Source: ${jd.source})`);

        // Send immediate response
        res.status(202).json({ message: 'JD analysis started.', jd });

        // Perform analysis asynchronously
        performJdAnalysis(jdId).catch(err => {
            // Catch errors from the async function itself if needed,
            // though it already tries to update the status internally.
            console.error(`Unhandled error during async performJdAnalysis for ${jdId}:`, err);
        });

    } catch (error) {
        console.error(`Error initiating analysis for JD ${jdId}:`, error);
        // Attempt to mark JD as failed only if the initial read/write failed
        try {
            let data = await readData();
            if (data.jds?.[jdId] && data.jds[jdId].status !== 'processing') { // Check if status wasn't already set
                data.jds[jdId].status = 'failed';
                data.jds[jdId].error = 'Failed to initiate analysis process.';
                await writeData(data);
            }
        } catch (writeError) {
            console.error(`Error marking JD ${jdId} as failed after initiation error:`, writeError);
        }
        // Send error response only if the initial read/write failed before 202 response
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to start JD analysis.' });
        }
    }
});

// Asynchronous function to handle the actual fetching and AI calls
async function performJdAnalysis(jdId) {
    let data;
    let jd;
    let textContent = ''; // Initialize textContent

    try {
        data = await readData();
        jd = data.jds?.[jdId];
        if (!jd) throw new Error(`JD ${jdId} not found during analysis start.`);
        if (jd.status !== 'processing') {
             console.warn(`JD ${jdId} status changed from processing before analysis could run. Current status: ${jd.status}. Aborting.`);
             return; // Abort if status changed (e.g., deleted)
        }

        // --- 1/2. Fetch URL Content OR Read PDF Content ---
        if (jd.type === 'url') {
            console.log(`Analysis: Fetching URL for JD ${jdId}: ${jd.source}`);
            try {
                const response = await axios.get(jd.source, {
                    headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 // Increased timeout
                });
                textContent = stripHtml(response.data);
                console.log(`Analysis: Fetched and stripped HTML for JD ${jdId}. Text length: ${textContent.length}`);
            } catch (fetchError) {
                throw new Error(`Failed to fetch URL (${fetchError.message})`);
            }
        } else if (jd.type === 'pdf') {
            const pdfPath = path.join(jdUploadDir, jd.source); // Use jdUploadDir
            console.log(`Analysis: Reading PDF for JD ${jdId}: ${pdfPath}`);
            try {
                if (!fsSync.existsSync(pdfPath)) throw new Error(`PDF file not found at ${pdfPath}`);
                const dataBuffer = await fs.readFile(pdfPath);
                // Use pdfjs-dist to parse
                const pdfDocument = await pdfjsLib.getDocument({ data: new Uint8Array(dataBuffer) }).promise;
                let fullText = '';
                for (let i = 1; i <= pdfDocument.numPages; i++) {
                    const page = await pdfDocument.getPage(i);
                    const pageTextContent = await page.getTextContent();
                    fullText += pageTextContent.items.map(item => item.str).join(' ') + '\n'; // Add newline between pages
                }
                textContent = fullText.trim();
                console.log(`Analysis: Parsed PDF for JD ${jdId}. Text length: ${textContent?.length}`);
            } catch (pdfError) {
                throw new Error(`Failed to parse PDF (${pdfError.message})`);
            }
        } else {
            throw new Error(`Unknown JD type: ${jd.type}`);
        }

        // --- Basic Content Check ---
        if (!textContent || textContent.length < 50) { // Stricter check
            throw new Error(`Extracted text content is too short (length: ${textContent?.length}). Analysis aborted.`);
        }

        // --- 3. Call Gemini for Analysis ---
        const analysisPrompt = `Analyze the following job description text and provide a structured summary. Extract the core information into these three sections:\n1. **Job Description:** A concise summary of the overall job purpose and context.\n2. **Roles and Responsibilities:** A bulleted list of the primary tasks and duties mentioned.\n3. **Candidate Requirements:** A bulleted list of the essential qualifications, skills, and experience explicitly stated.\n\nFocus on accuracy and clarity based *only* on the provided text. If the text is unclear or lacks information for a section, state that clearly (e.g., "Not specified in the text."). Do not invent or infer information beyond what is written.\n\nJob Description Text:\n---\n${textContent.substring(0, 30000)}\n---`;
        console.log(`Analysis: Sending analysis prompt to Gemini for JD ${jdId}`);
        let analysisResultText = '';
        try {
            const analysisGenResult = await model.generateContent({ contents: [{ role: "user", parts: [{ text: analysisPrompt }] }], generationConfig, safetySettings });
            if (!analysisGenResult.response.candidates || analysisGenResult.response.candidates.length === 0) {
                throw new Error(`Gemini analysis blocked. Reason: ${analysisGenResult.response.promptFeedback?.blockReason || 'No candidates'}`);
            }
            analysisResultText = analysisGenResult.response.text();
            console.log(`Analysis: Received analysis from Gemini for JD ${jdId}`);
        } catch (aiError) {
            throw new Error(`Gemini analysis call failed: ${aiError.message}`);
        }

        // --- 4. Call Gemini for Keyword Extraction ---
        const keywordsPrompt = `From the following job description text, extract a list of the most important keywords representing required skills, technologies, tools, methodologies, qualifications, and specific responsibilities. Focus on concrete terms (e.g., "Project Management", "Python", "Salesforce", "Agile", "MBA", "Data Analysis", "Client Communication", "Budget Management", "AWS", "React"). Avoid generic filler words or overly broad terms unless they are explicitly emphasized as requirements. Provide the keywords as a comma-separated list ONLY. Do not add any introductory text.\n\nJob Description Text:\n---\n${textContent.substring(0, 30000)}\n---\n\nKeywords:`;
        console.log(`Analysis: Sending keywords prompt to Gemini for JD ${jdId}`);
        let keywordsResultList = [];
        try {
            const keywordsGenResult = await model.generateContent({ contents: [{ role: "user", parts: [{ text: keywordsPrompt }] }], generationConfig, safetySettings });
            if (keywordsGenResult.response.candidates && keywordsGenResult.response.candidates.length > 0) {
                const keywordsText = keywordsGenResult.response.text();
                keywordsResultList = keywordsText.split(',').map(k => k.trim()).filter(k => k.length > 1); // Filter empty/single char
                console.log(`Analysis: Received ${keywordsResultList.length} keywords from Gemini for JD ${jdId}`);
            } else {
                 console.warn(`Analysis: Gemini keywords request blocked or no candidates for JD ${jdId}. Reason: ${keywordsGenResult.response.promptFeedback?.blockReason || 'No candidates'}`);
            }
        } catch (aiError) {
            console.warn(`Analysis: Gemini keywords extraction failed for JD ${jdId}: ${aiError.message}. Proceeding without keywords.`);
            // Continue without keywords, don't fail the whole analysis
        }

        // --- 5. Update Data File with Results ---
        data = await readData(); // Re-read data
        jd = data.jds?.[jdId];
        if (jd && jd.status === 'processing') { // Ensure it's still processing
            jd.status = 'completed';
            jd.analysis = analysisResultText;
            jd.keywords = keywordsResultList;
            jd.analyzedAt = new Date().toISOString();
            jd.error = null;
            await writeData(data);
            console.log(`Analysis: Successfully completed and saved analysis for JD ${jdId}`);
        } else {
             console.warn(`Analysis: JD ${jdId} status was not 'processing' when trying to save results. Current status: ${jd?.status}. Results not saved.`);
        }

    } catch (error) {
        console.error(`Analysis: Full process failed for JD ${jdId}:`, error);
        // Update status to 'failed' in data.json
        try {
            data = await readData(); // Re-read data
            jd = data.jds?.[jdId];
            // Only update if it's still processing or pending (avoid overwriting completed/other failures)
            if (jd && (jd.status === 'processing' || jd.status === 'pending')) {
                jd.status = 'failed';
                jd.error = error.message || 'An unknown error occurred during analysis.';
                await writeData(data);
                console.log(`Analysis: Marked JD ${jdId} as failed due to error.`);
            }
        } catch (writeError) {
            console.error(`Analysis: Failed to write failure status for JD ${jdId}:`, writeError);
        }
    }
}

// Get ALL completed JDs (for the new dropdown)
app.get('/api/jds', async (req, res) => {
    console.log("Received request for all completed JDs");
    try {
        const data = await readData();
        const rolesMap = data.roles || {};
        const completedJds = Object.values(data.jds || {})
            .filter(jd => jd.status === 'completed')
            .map(jd => ({
                id: jd.id,
                roleId: jd.roleId,
                roleName: rolesMap[jd.roleId]?.name || 'Unknown Role', // Add role name
                type: jd.type,
                source: jd.source,
                originalFilename: jd.originalFilename, // Include original filename if available
                createdAt: jd.createdAt,
                analyzedAt: jd.analyzedAt,
            }));
        console.log(`Found ${completedJds.length} completed JDs.`);
        res.json(completedJds);
    } catch (error) {
        console.error('Error getting all completed JDs:', error);
        res.status(500).json({ error: 'Failed to retrieve completed JDs.' });
    }
});


// Get all JDs for a specific Role
app.get('/api/roles/:roleId/jds', async (req, res) => {
    const { roleId } = req.params;
    try {
        const data = await readData();
        if (!data.roles?.[roleId]) {
            return res.status(404).json({ error: 'Role not found.' });
        }
        const roleJds = Object.values(data.jds || {}).filter(jd => jd.roleId === roleId);
        res.json(roleJds);
    } catch (error) {
        console.error(`Error getting JDs for role ${roleId}:`, error);
        res.status(500).json({ error: 'Failed to retrieve JDs for the role.' });
    }
});


// Get keyword summary for a specific Role
app.get('/api/roles/:roleId/keywords', async (req, res) => {
    const { roleId } = req.params;
    try {
        const data = await readData();
        const role = data.roles?.[roleId];
        if (!role) {
            return res.status(404).json({ error: 'Role not found.' });
        }

        const keywordCounts = {};
        let completedJdCount = 0;
        const jdIds = role.jdIds || []; // Handle case where jdIds might be missing

        for (const jdId of jdIds) {
            const jd = data.jds?.[jdId];
            if (jd && jd.status === 'completed' && Array.isArray(jd.keywords)) {
                completedJdCount++;
                jd.keywords.forEach(keyword => {
                    const normalizedKeyword = keyword.toLowerCase().trim(); // Normalize
                    if(normalizedKeyword) { // Ensure not empty after trim
                       keywordCounts[normalizedKeyword] = (keywordCounts[normalizedKeyword] || 0) + 1;
                    }
                });
            }
        }

        const sortedKeywords = Object.entries(keywordCounts)
            .map(([keyword, count]) => ({ keyword, count }))
            .sort((a, b) => b.count - a.count);

        res.json({
            roleId: roleId,
            roleName: role.name,
            completedJdCount: completedJdCount,
            keywordsSummary: sortedKeywords,
        });

    } catch (error) {
        console.error(`Error getting keyword summary for role ${roleId}:`, error);
        res.status(500).json({ error: 'Failed to generate keyword summary.' });
    }
});

// --- DELETE Endpoints ---

// Delete a specific JD
app.delete('/api/jds/:jdId', async (req, res) => {
    const { jdId } = req.params;
    console.log(`Received request to delete JD: ${jdId}`);
    try {
        let data = await readData();
        const jd = data.jds?.[jdId];

        if (!jd) {
            console.log(`Delete failed: JD ${jdId} not found.`);
            return res.status(404).json({ error: 'JD not found.' });
        }

        const roleId = jd.roleId;

        // 1. Remove JD ID from the parent role
        if (data.roles?.[roleId]?.jdIds) {
            data.roles[roleId].jdIds = data.roles[roleId].jdIds.filter(id => id !== jdId);
            console.log(`Removed JD ${jdId} reference from Role ${roleId}`);
        } else {
             console.warn(`Could not find Role ${roleId} or its jdIds array when deleting JD ${jdId}.`);
        }

        // 2. Delete the physical file if it's a PDF
        if (jd.type === 'pdf' && jd.source) {
            const pdfPath = path.join(jdUploadDir, jd.source); // Use jdUploadDir
            try {
                await fs.unlink(pdfPath);
                console.log(`Deleted PDF file: ${pdfPath}`);
            } catch (unlinkError) {
                // Log error but continue deletion from data.json
                console.error(`Error deleting PDF file ${pdfPath} for JD ${jdId}:`, unlinkError);
                // Optionally: Decide if this should prevent DB deletion? For now, we proceed.
            }
        }

        // 3. Remove the JD object from the data
        delete data.jds[jdId];
        console.log(`Removed JD ${jdId} object from data.`);

        // 4. Write updated data back to file
        await writeData(data);
        console.log(`Successfully deleted JD ${jdId}.`);
        res.status(204).send(); // No Content success status

    } catch (error) {
        console.error(`Error deleting JD ${jdId}:`, error);
        res.status(500).json({ error: 'Failed to delete JD.' });
    }
});

// Delete a specific Role and its associated JDs
app.delete('/api/roles/:roleId', async (req, res) => {
    const { roleId } = req.params;
    console.log(`Received request to delete Role: ${roleId}`);
    try {
        let data = await readData();
        const role = data.roles?.[roleId];

        if (!role) {
            console.log(`Delete failed: Role ${roleId} not found.`);
            return res.status(404).json({ error: 'Role not found.' });
        }

        const jdIdsToDelete = role.jdIds || [];
        console.log(`Role ${roleId} has ${jdIdsToDelete.length} associated JDs to delete.`);

        // 1. Delete associated JDs (including files)
        for (const jdId of jdIdsToDelete) {
            const jd = data.jds?.[jdId];
            if (jd) {
                // Delete PDF file if applicable
                if (jd.type === 'pdf' && jd.source) {
                    const pdfPath = path.join(jdUploadDir, jd.source); // Use jdUploadDir
                    try {
                        await fs.unlink(pdfPath);
                        console.log(`Deleted PDF file for associated JD ${jdId}: ${pdfPath}`);
                    } catch (unlinkError) {
                        console.error(`Error deleting PDF file ${pdfPath} for associated JD ${jdId} during role deletion:`, unlinkError);
                    }
                }
                // Remove JD object
                delete data.jds[jdId];
                console.log(`Removed associated JD object ${jdId}.`);
            } else {
                 console.warn(`Could not find associated JD ${jdId} listed in Role ${roleId} during deletion.`);
            }
        }

        // 2. Remove the Role object
        delete data.roles[roleId];
        console.log(`Removed Role ${roleId} object from data.`);

        // 3. Write updated data back to file
        await writeData(data);
        console.log(`Successfully deleted Role ${roleId} and its associated JDs.`);
        res.status(204).send(); // No Content success status

    } catch (error) {
        console.error(`Error deleting Role ${roleId}:`, error);
        res.status(500).json({ error: 'Failed to delete Role.' });
    }
});


// --- Helper function to get JD text content (Refactored from performJdAnalysis) ---
async function getJdTextContent(jd) {
    let textContent = '';
    if (!jd || !jd.type || !jd.source) {
        throw new Error('Invalid JD object provided to getJdTextContent.');
    }

    if (jd.type === 'url') {
        console.log(`Helper: Fetching URL for JD ${jd.id}: ${jd.source}`);
        try {
            const response = await axios.get(jd.source, {
                headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000
            });
            textContent = stripHtml(response.data);
            console.log(`Helper: Fetched and stripped HTML for JD ${jd.id}. Text length: ${textContent.length}`);
        } catch (fetchError) {
            throw new Error(`Helper: Failed to fetch URL (${fetchError.message})`);
        }
    } else if (jd.type === 'pdf') {
        const pdfPath = path.join(jdUploadDir, jd.source);
        console.log(`Helper: Reading PDF for JD ${jd.id}: ${pdfPath}`);
        try {
            if (!fsSync.existsSync(pdfPath)) throw new Error(`Helper: PDF file not found at ${pdfPath}`);
            const dataBuffer = await fs.readFile(pdfPath);
            const pdfDocument = await pdfjsLib.getDocument({ data: new Uint8Array(dataBuffer) }).promise;
            let fullText = '';
            for (let i = 1; i <= pdfDocument.numPages; i++) {
                const page = await pdfDocument.getPage(i);
                const pageTextContent = await page.getTextContent();
                fullText += pageTextContent.items.map(item => item.str).join(' ') + '\n';
            }
            textContent = fullText.trim();
            console.log(`Helper: Parsed PDF for JD ${jd.id}. Text length: ${textContent?.length}`);
        } catch (pdfError) {
            throw new Error(`Helper: Failed to parse PDF (${pdfError.message})`);
        }
    } else {
        throw new Error(`Helper: Unknown JD type: ${jd.type}`);
    }

    if (!textContent || textContent.length < 50) {
        console.warn(`Helper: Extracted text content for JD ${jd.id} is short (length: ${textContent?.length}).`);
        // Don't throw error here, let the caller decide if it's fatal
    }
    return textContent;
}

// --- SSE Setup ---
// Simple in-memory store for active connections and job progress
const sseClients = {}; // Store { jobId: { res: Response } }
// Store job progress including structured resume data and processed points
const jobProgress = {}; // Store { jobId: { structuredResumeData: object | null, extractedPoints: string[], processedPoints: [], status: 'processing'|'done'|'error', error: null } }

// Helper to send SSE events
function sendSseEvent(jobId, data) {
    const clientInfo = sseClients[jobId];
    if (clientInfo && clientInfo.res) {
        clientInfo.res.write(`data: ${JSON.stringify(data)}\n\n`);
    } else {
        // Don't warn excessively if client disconnects before job finishes
        // console.warn(`SSE: No active client found for jobId ${jobId} when trying to send event.`);
    }
}

// Background processing function
async function processResumePointsInBackground(jobId, jobDetails) {
    // Retrieve extractedPoints from jobProgress, not jobDetails argument
    const currentJobData = jobProgress[jobId];
    if (!currentJobData || !currentJobData.extractedPoints) {
        console.error(`SSE Background: Job ${jobId} - Cannot start processing, extractedPoints not found in jobProgress.`);
        // Update status to error
        if (currentJobData) {
            currentJobData.status = 'error';
            currentJobData.error = 'Internal error: Extracted points missing.';
            sendSseEvent(jobId, { type: 'error', payload: { message: currentJobData.error } });
        }
        return; // Stop processing
    }
    const extractedPoints = currentJobData.extractedPoints; // Get points from jobProgress
    const { analysisContext, contextName, targetKeywords, specificJdAnalysisSummary } = jobDetails; // Get other details from args

    console.log(`SSE Background: Starting processing for job ${jobId} with ${extractedPoints.length} points.`);

    // Update status in the existing jobProgress object
    currentJobData.status = 'processing';
    currentJobData.processedPoints = []; // Ensure processedPoints is reset if retrying
    currentJobData.error = null;

    const maxPointsToProcess = 50; // Safety limit
    let pointsProcessedCount = 0;

    // Prepare context string for relevance check (either role keywords or JD text)
    let relevanceContext = '';
     if (analysisContext === 'role') {
         relevanceContext = `the role "${contextName}" described by keywords: "${targetKeywords.join(', ').substring(0, 1500)}"`;
     } else { // analysisContext === 'jd'
         // Note: specificJdText is not passed here, using summary/keywords for context
         relevanceContext = `this job description context: "${(specificJdAnalysisSummary || 'JD details unavailable').substring(0, 1500)}" (Keywords: ${targetKeywords.join(', ').substring(0, 500)})`;
     }

    // Add a small delay to allow the client to connect to the SSE endpoint
    await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay

    try {
        for (const point of extractedPoints) {
            // Check if client is still connected before processing each point
            // Only abort if the client *was* connected and is now gone, or if processing just started and they never connected after the delay.
            if (!sseClients[jobId]) {
                 console.log(`SSE Background: Client for job ${jobId} disconnected. Aborting processing.`);
                 // Optionally mark job as aborted in jobProgress
                 if (jobProgress[jobId]) jobProgress[jobId].status = 'aborted';
                 return; // Stop processing if client is gone
            }

            if (pointsProcessedCount >= maxPointsToProcess) {
                console.warn(`SSE Background: Reached maximum point processing limit (${maxPointsToProcess}) for job ${jobId}.`);
                const limitEvent = { type: 'point_processed', payload: { original: point, suggestions: ["Processing limit reached."], isRelevant: false, error: null } };
                sendSseEvent(jobId, limitEvent);
                jobProgress[jobId]?.processedPoints.push(limitEvent.payload); // Store progress
                break; // Exit the loop
            }
            pointsProcessedCount++;
            console.log(`SSE Background: Job ${jobId} - Processing Point ${pointsProcessedCount}/${extractedPoints.length}: "${point.substring(0, 50)}..."`);

            // Send progress update event
            sendSseEvent(jobId, { type: 'progress', payload: { current: pointsProcessedCount, total: extractedPoints.length, message: `Processing point ${pointsProcessedCount}...` } });


            let isRelevant = false;
            let suggestions = [];
            let pointError = null;
            let isDefaultSuggestion = false; // Flag for default suggestion

            try {
                // 4a. AI Relevance Check
                const relevancePrompt = `Is the following resume bullet point relevant to ${relevanceContext}? Respond ONLY with "yes" or "no".\n\nBullet Point: "${point}"`;
                const relevanceResult = await model.generateContent({
                    contents: [{ role: "user", parts: [{ text: relevancePrompt }] }],
                    generationConfig: { ...generationConfig, temperature: 0.1, maxOutputTokens: 10 },
                    safetySettings,
                });

                if (relevanceResult.response.candidates && relevanceResult.response.candidates.length > 0) {
                    const relevanceText = relevanceResult.response.text().trim().toLowerCase();
                    isRelevant = relevanceText.includes('yes');
                } else {
                    const blockReason = relevanceResult.response.promptFeedback?.blockReason;
                    console.warn(`SSE Background: Job ${jobId} - Relevance check blocked/failed. Assuming not relevant. Reason: ${blockReason || 'No candidates'}`);
                    isRelevant = false;
                }

                // 4b. Get Suggestions based on Relevance
                let suggestionPrompt = '';
                if (isRelevant) {
                    suggestionPrompt = `Rewrite the following resume bullet point to be more impactful and concise, starting directly with a strong action verb. Use the CAR (Challenge-Action-Result) or STAR (Situation-Task-Action-Result) framework as a guideline to structure the *content* (ensuring you cover the situation/challenge, the action taken, and the result), but ensure the final statement flows naturally and begins with the action. Incorporate relevant keywords from this list where appropriate: "${targetKeywords.join(', ').substring(0, 1000)}". Focus on the context of ${analysisContext === 'role' ? `the role "${contextName}"` : `the specific job description`}. Provide 1 or 2 distinct rewritten suggestions ONLY, each on a new line. Do not include the original point or introductory text. Example: 'Spearheaded the development of a new reporting system resulting in a 15% reduction in processing time.'\n\nOriginal Point: "${point}"`;
                } else {
                    suggestionPrompt = `Rewrite the following resume bullet point to be more impactful and concise for general resume use, starting directly with a strong action verb. Use the CAR (Challenge-Action-Result) or STAR (Situation-Task-Action-Result) framework as a guideline to structure the *content* (ensuring you cover the situation/challenge, the action taken, and the result), but ensure the final statement flows naturally and begins with the action. Focus on quantifying results if possible. Do NOT force relevance to any specific role or keywords. Provide 1 or 2 distinct rewritten suggestions ONLY, each on a new line. Do not include the original point or introductory text. Example: 'Optimized database queries, improving application response time by 20%.'\n\nOriginal Point: "${point}"`;
                }

                const suggestionResult = await model.generateContent({
                    contents: [{ role: "user", parts: [{ text: suggestionPrompt }] }],
                    generationConfig: { ...generationConfig, temperature: 0.7, maxOutputTokens: 512 },
                    safetySettings,
                });

                if (suggestionResult.response.candidates && suggestionResult.response.candidates.length > 0) {
                    const suggestionText = suggestionResult.response.text();
                    suggestions = suggestionText.split('\n')
                        .map(s => s.trim().replace(/^[-*•]\s*/, ''))
                        .filter(s => s.length > 10 && s.toLowerCase() !== point.toLowerCase());
                    if (suggestions.length === 0) {
                         console.warn(`SSE Background: Job ${jobId} - AI returned suggestions, but none passed filtering.`);
                         suggestions = ["Could not generate valid suggestions for this point."];
                    }
                } else {
                    const blockReason = suggestionResult.response.promptFeedback?.blockReason;
                    console.warn(`SSE Background: Job ${jobId} - Suggestion generation blocked/failed. Reason: ${blockReason || 'No candidates'}`);
                    suggestions = ["Could not generate suggestions for this point."]; // Keep as array for consistency
                    pointError = "Suggestion generation failed or blocked."; // Set error message
                }

                // Determine the default suggestion
                if (!pointError && suggestions.length > 0) {
                    // If relevant suggestions exist, the first one is default
                    // If only general suggestions exist, the first one is default
                    isDefaultSuggestion = true;
                }
                // If there's an error or no suggestions, the original point implicitly remains the default choice in the UI

            } catch (innerError) {
                 console.error(`SSE Background: Job ${jobId} - Error processing point "${point.substring(0, 50)}...":`, innerError);
                 pointError = innerError.message || 'Unknown error processing point.';
                 suggestions = [`Error: ${pointError}`];
                 // Continue to the next point
            }

            // Send event for the processed point
            const pointEvent = {
                type: 'point_processed',
                payload: {
                    original: point,
                    suggestions: suggestions.slice(0, 2), // Limit to max 2 suggestions
                    isRelevant: isRelevant,
                    isDefault: isDefaultSuggestion, // Add the default flag
                    error: pointError // Include point-specific error if any
                }
            };
            sendSseEvent(jobId, pointEvent);
            // Store the full payload including the isDefault flag
            jobProgress[jobId]?.processedPoints.push(pointEvent.payload); // Store progress

        } // End of loop

        // Send final "done" event if loop completed naturally
        console.log(`SSE Background: Job ${jobId} finished processing ${pointsProcessedCount} points.`);
        sendSseEvent(jobId, { type: 'done', payload: { message: `Processing complete. ${pointsProcessedCount} points processed.` } });
        if (jobProgress[jobId]) jobProgress[jobId].status = 'done';

    } catch (outerError) {
        // Catch errors occurring outside the loop (e.g., initial setup within this function if moved here)
        console.error(`SSE Background: Job ${jobId} - Unrecoverable error during processing:`, outerError);
        if (jobProgress[jobId]) {
            jobProgress[jobId].status = 'error';
            jobProgress[jobId].error = outerError.message || 'An unknown background processing error occurred.';
        }
        sendSseEvent(jobId, { type: 'error', payload: { message: jobProgress[jobId]?.error } });
    } finally {
        // Clean up client connection after a short delay (allows final message to send)
        setTimeout(() => {
            const clientInfo = sseClients[jobId];
            if (clientInfo && clientInfo.res) {
                clientInfo.res.end(); // Close the connection
            }
            delete sseClients[jobId];
            // Optionally delete jobProgress[jobId] after some time too
            console.log(`SSE: Cleaned up resources for job ${jobId}`);
        }, 5000); // 5 second delay
    }
}


// --- Resume Customizer Endpoint (Modified for SSE Initiation) ---

app.post('/api/customize-resume', (req, res, next) => {
    // Wrap resume upload multer
    const uploader = resumeUpload.single('resumePdf');
    uploader(req, res, async (uploadError) => {
        if (uploadError) {
            console.error("Resume upload error:", uploadError);
            if (uploadError instanceof multer.MulterError) {
                return res.status(400).json({ error: `Resume upload error: ${uploadError.message}` });
            } else {
                return res.status(400).json({ error: uploadError.message || 'Resume upload failed.' });
            }
        }
        if (!req.file) {
             return res.status(400).json({ error: 'No resume PDF file uploaded or file rejected.' });
        }
        // If upload is successful, proceed
        next();
    });
}, async (req, res) => {
    const { roleId, jdId } = req.body;
    const resumeFile = req.file;
    const jobId = uuidv4(); // Generate unique ID for this job

    // --- Initial Validation ---
    if (!roleId && !jdId) {
        // Clean up uploaded file immediately if validation fails
        await fs.unlink(resumeFile.path).catch(err => console.error("Cleanup Error: Failed to delete temp resume file (missing roleId/jdId):", err));
        return res.status(400).json({ error: 'Either Role ID or JD ID is required.' });
    }
    if (roleId && jdId) {
        await fs.unlink(resumeFile.path).catch(err => console.error("Cleanup Error: Failed to delete temp resume file (both roleId/jdId provided):", err));
        return res.status(400).json({ error: 'Provide either Role ID or JD ID, not both.' });
    }
    if (!resumeFile) {
        // Should be caught by middleware, but double-check
        return res.status(400).json({ error: 'Resume PDF file is required.' });
    }

    console.log(`Received customize request for ${roleId ? `Role ID: ${roleId}` : `JD ID: ${jdId}`}, Resume: ${resumeFile.originalname}. Assigning Job ID: ${jobId}`);
    const tempResumePath = resumeFile.path;

    // --- Perform Setup Synchronously (Validation, Parsing, AI Extraction) ---
    let resumeTextContent = '';
    let targetKeywords = [];
    let contextName = 'Unknown Context';
    let analysisContext = roleId ? 'role' : 'jd';
    let specificJdAnalysisSummary = null;
    let structuredResumeData = null; // To store the AI-parsed structured data
    let accomplishmentPoints = []; // Store only accomplishment points for suggestions

    try {
        // 1. Read data and get context (Role or JD) - NO CHANGE HERE
        const data = await readData();
        let role = null;
        let specificJd = null;

        if (roleId) {
            role = data.roles?.[roleId];
            if (!role) {
                throw new Error('Target role not found.'); // Throw instead of returning
            }
            contextName = role.name;
            console.log(`Job ${jobId}: Analyzing by Role: ${contextName}`);
            // Aggregate keywords (same as before)
            const keywordCounts = {};
            const roleJdIds = role.jdIds || [];
            for (const currentJdId of roleJdIds) {
                const jd = data.jds?.[currentJdId];
                if (jd && jd.status === 'completed' && Array.isArray(jd.keywords)) {
                    jd.keywords.forEach(keyword => {
                        const normalizedKeyword = keyword.toLowerCase().trim();
                        if (normalizedKeyword) keywordCounts[normalizedKeyword] = (keywordCounts[normalizedKeyword] || 0) + 1;
                    });
                }
            }
            targetKeywords = Object.keys(keywordCounts);
            console.log(`Job ${jobId}: Aggregated ${targetKeywords.length} unique keywords for role ${roleId}.`);

        } else { // jdId is provided
            specificJd = data.jds?.[jdId];
            if (!specificJd) {
                throw new Error('Target JD not found.');
            }
            if (specificJd.status !== 'completed') {
                throw new Error(`Target JD (${specificJd.originalFilename || specificJd.source}) has not been analyzed yet (status: ${specificJd.status}).`);
            }
            contextName = specificJd.originalFilename || specificJd.source;
            console.log(`Job ${jobId}: Analyzing by Specific JD: ${contextName} (ID: ${jdId})`);
            targetKeywords = specificJd.keywords || [];
            specificJdAnalysisSummary = specificJd.analysis || 'Analysis summary not available.';
            console.log(`Job ${jobId}: Using ${targetKeywords.length} keywords from specific JD ${jdId}.`);
            // Note: We don't need specificJdText here anymore for the initial setup
            if (targetKeywords.length === 0) {
                 console.warn(`Job ${jobId}: No keywords found for specific JD ${contextName}.`);
            }
        }

        // 2. Parse resume PDF text (same as before)
        console.log(`Job ${jobId}: Parsing resume PDF: ${tempResumePath}`);
        try {
            const dataBuffer = await fs.readFile(tempResumePath);
            const pdfDocument = await pdfjsLib.getDocument({ data: new Uint8Array(dataBuffer) }).promise;
            let fullText = '';
            for (let i = 1; i <= pdfDocument.numPages; i++) {
                const page = await pdfDocument.getPage(i);
                const pageTextContent = await page.getTextContent();
                fullText += pageTextContent.items.map(item => item.str).join(' ') + '\n';
            }
            resumeTextContent = fullText.trim();
            console.log(`Job ${jobId}: Parsed resume PDF. Text length: ${resumeTextContent?.length}`);
            if (!resumeTextContent || resumeTextContent.length < 50) {
                throw new Error(`Extracted resume text content is too short (length: ${resumeTextContent?.length}).`);
            }
        } catch (pdfError) {
            console.error(`Job ${jobId}: Failed to parse resume PDF ${tempResumePath}:`, pdfError);
            throw new Error(`Failed to parse resume PDF: ${pdfError.message}`);
        } finally {
             // Delete the temp resume file *after* parsing or on error during parsing
             await fs.unlink(tempResumePath).catch(err => console.error(`Cleanup Error: Failed to delete temp resume file ${tempResumePath}:`, err));
             console.log(`Job ${jobId}: Cleaned up temporary resume file: ${tempResumePath}`);
        }

        // 3. NEW: Structure Resume Text using AI
        console.log(`Job ${jobId}: Structuring resume text using AI...`);
        try {
            // Define the desired JSON structure
            const jsonStructureExample = {
                name: "string (Full Name)",
                contactInfo: { phone: "string", email: "string", linkedin: "string (URL, optional)", location: "string (City, State/Country)" },
                summary: "string (Professional summary paragraph)",
                experience: [
                    { company: "string", location: "string (optional)", dates: "string (e.g., YYYY-MM - YYYY-MM or Present)", title: "string", accomplishments: ["string (bullet point)", "string"] }
                ],
                education: [
                    { degree: "string", institution: "string", date: "string (e.g., YYYY or YYYY-MM)" }
                ],
                skills: { // Flexible: could be categories or a single list
                    "category (e.g., Programming Languages)": ["string", "string"],
                    "category (e.g., Tools)": ["string"]
                 } // Or potentially: skills: ["skill1", "skill2"]
                 // Add other common sections if needed, e.g., projects: [{ name: "...", description: "...", accomplishments: ["..."] }]
            };

            const structuringPrompt = `Analyze the following resume text and extract its content into a structured JSON object. Adhere strictly to this JSON format: ${JSON.stringify(jsonStructureExample)}.
            - Extract the full name.
            - Extract contact information (phone, email, LinkedIn URL if present, location).
            - Extract the professional summary or objective statement.
            - For each work experience entry, extract company name, location (if available), dates of employment, job title, and a list of accomplishment/responsibility bullet points.
            - For each education entry, extract degree name, institution name, and graduation/attendance date.
            - Extract skills, attempting to group them into logical categories (like 'Programming Languages', 'Tools', 'Certifications') if possible, otherwise provide a single list under a generic 'Technical Skills' or 'Skills' key. If grouping, the value should be an array of strings.
            - Preserve all key information accurately. If a section (like summary or a specific contact field) is missing, use null or an empty string/array as appropriate for the field type in the JSON structure.
            - Ensure the output is ONLY the valid JSON object, enclosed in \`\`\`json ... \`\`\`. Do not include any other text before or after the JSON block.

            Resume Text:
            ---
            ${resumeTextContent.substring(0, 30000)}
            ---

            JSON Output:`;

            // Use a model optimized for JSON output if available, or adjust config
            const structuringResult = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: structuringPrompt }] }],
                generationConfig: { ...generationConfig, temperature: 0.2, responseMimeType: "application/json" }, // Lower temp for structure, request JSON
                safetySettings,
            });

            if (!structuringResult.response.candidates || structuringResult.response.candidates.length === 0) {
                const blockReason = structuringResult.response.promptFeedback?.blockReason;
                throw new Error(`AI resume structuring blocked or failed. Reason: ${blockReason || 'No candidates'}`);
            }

            const responseText = structuringResult.response.text();
            // Attempt to parse the JSON (assuming responseMimeType worked, otherwise need robust parsing)
             try {
                 structuredResumeData = JSON.parse(responseText);
             } catch (parseError) {
                  console.error("Failed to parse JSON structure from AI response:", parseError);
                  console.error("Raw AI response for structuring:", responseText);
                  // Attempt to extract from code block as fallback
                   const codeBlockMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
                   if (codeBlockMatch && codeBlockMatch[1]) {
                       try {
                           structuredResumeData = JSON.parse(codeBlockMatch[1]);
                           console.log("Successfully parsed JSON from code block fallback.");
                       } catch (fallbackParseError) {
                            console.error("Fallback JSON parsing also failed:", fallbackParseError);
                            throw new Error('AI response for structured resume was not valid JSON, even in code block.');
                       }
                   } else {
                       throw new Error('AI response for structured resume was not valid JSON.');
                   }
             }

            // Validate basic structure (can be expanded)
            if (!structuredResumeData || typeof structuredResumeData !== 'object' || !structuredResumeData.name) {
                 throw new Error('AI returned invalid or incomplete JSON structure for the resume.');
            }
            console.log(`Job ${jobId}: Successfully structured resume using AI. Name: ${structuredResumeData.name}`);

            // Extract accomplishment points from the structured data for suggestions
            if (structuredResumeData.experience && Array.isArray(structuredResumeData.experience)) {
                structuredResumeData.experience.forEach(exp => {
                    if (exp.accomplishments && Array.isArray(exp.accomplishments)) {
                        accomplishmentPoints.push(...exp.accomplishments.filter(acc => typeof acc === 'string' && acc.trim().length > 5));
                    }
                });
            }
             // Optionally extract from other sections like projects if added to the structure
            console.log(`Job ${jobId}: Extracted ${accomplishmentPoints.length} accomplishment points from structured data for suggestions.`);


        } catch (structuringError) {
             console.error(`Job ${jobId}: Error during AI resume structuring:`, structuringError);
             throw new Error(`Failed to structure resume using AI: ${structuringError.message}`);
        }

        if (accomplishmentPoints.length === 0) {
            // Don't throw an error here, maybe the resume has no experience points.
            // The background process will handle having no points to process.
            console.warn(`Job ${jobId}: No accomplishment points found in the structured resume data to generate suggestions for.`);
        }


        // --- Setup Complete ---

        // Store the structured resume data and the extracted points for background processing
        jobProgress[jobId] = {
            structuredResumeData: structuredResumeData, // Store the structured JSON
            extractedPoints: accomplishmentPoints,      // Store only the points needing suggestions
            processedPoints: [], // Initialize processed points array
            status: 'pending', // Will be updated by background process
            error: null
        };

        // Prepare details for the background function
        const jobDetails = {
            analysisContext,
            contextName,
            targetKeywords,
            specificJdAnalysisSummary
        };
        // Note: We don't pass points or resume text anymore, they are in jobProgress

        // Respond immediately with Job ID and initial context
        res.status(202).json({
            jobId: jobId,
            message: `Processing started for ${accomplishmentPoints.length} points. Connect to the stream for results.`,
            analysisContext: analysisContext,
            contextName: contextName,
            jdAnalysisSummary: specificJdAnalysisSummary // Send JD summary immediately if available
        });

        // Trigger background processing (don't await it)
        processResumePointsInBackground(jobId, jobDetails);


    } catch (error) {
        // Handle errors during the initial setup phase
        console.error(`Job ${jobId}: Error during initial setup for resume customization:`, error);
        // Ensure temp file is deleted if setup failed early and file still exists
        if (fsSync.existsSync(tempResumePath)) {
             await fs.unlink(tempResumePath).catch(err => console.error(`Cleanup Error: Failed to delete temp resume file ${tempResumePath} after setup error:`, err));
        }
        // Send error response only if headers haven't been sent
        if (!res.headersSent) {
            res.status(500).json({ error: `Failed to start resume customization: ${error.message}` });
        }
    }
    // No finally block needed here as file deletion is handled within the try/catch for parsing
});


// --- SSE Endpoint for Streaming Results ---
app.get('/api/customize-stream/:jobId', (req, res) => {
    const { jobId } = req.params;
    console.log(`SSE: Client connected for job ${jobId}`);

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Flush the headers to establish the connection

    // Store the client response object
    sseClients[jobId] = { res };

    // If the job already finished or errored before client connected, send final status
    const currentProgress = jobProgress[jobId];
    if (currentProgress) {
        console.log(`SSE: Job ${jobId} already has progress. Status: ${currentProgress.status}, Points: ${currentProgress.processedPoints.length}`);
        // Send already processed points
        currentProgress.processedPoints.forEach(pointData => {
             sendSseEvent(jobId, { type: 'point_processed', payload: pointData });
        });
        // Send final status if done/error
        if (currentProgress.status === 'done') {
            sendSseEvent(jobId, { type: 'done', payload: { message: 'Processing already complete.' } });
            // Close immediately as job is done
            res.end();
            delete sseClients[jobId];
            console.log(`SSE: Sent final 'done' status to late-connecting client for job ${jobId} and closed.`);
        } else if (currentProgress.status === 'error') {
             sendSseEvent(jobId, { type: 'error', payload: { message: currentProgress.error || 'An unknown error occurred previously.' } });
             // Close immediately as job errored
             res.end();
             delete sseClients[jobId];
             console.log(`SSE: Sent final 'error' status to late-connecting client for job ${jobId} and closed.`);
        }
        // If status is still 'processing', the background job will continue sending events.
    } else {
         // Send initial 'connected' message if job hasn't started processing yet or progress not found
         console.log(`SSE: Job ${jobId} has no progress yet. Sending connected message.`);
         sendSseEvent(jobId, { type: 'connected', payload: { message: 'Connected to stream. Waiting for processing...' } });
    }


    // Handle client disconnect
    req.on('close', () => {
        console.log(`SSE: Client disconnected for job ${jobId}`);
        if (sseClients[jobId]) {
            sseClients[jobId].res = null; // Prevent sending more events to this closed connection
            delete sseClients[jobId];
        }
        // Optionally: Stop background processing if client disconnects? (More complex)
        // For now, let background process complete, but events won't be sent.
    });
});


// --- NEW Endpoint for Generating Edited PDF ---
app.post('/api/generate-edited-pdf', async (req, res) => {
    const { jobId, selections } = req.body; // selections: { "original point text": "selected suggestion text" }

    if (!jobId || !selections) {
        return res.status(400).json({ error: 'Job ID and selections are required.' });
    }

    console.log(`Received request to generate PDF for job ${jobId}`);
    const jobData = jobProgress[jobId];

    // Retrieve the STRUCTURED data now
    if (!jobData || !jobData.structuredResumeData) {
        return res.status(404).json({ error: 'Structured job data not found. Process might not be complete, failed, or job expired.' });
    }
    if (jobData.status === 'processing') {
         return res.status(400).json({ error: 'Resume analysis is still in progress. Please wait.' });
    }
     if (jobData.status === 'error') {
         return res.status(500).json({ error: `Cannot generate PDF, the initial analysis failed: ${jobData.error}` });
     }

    try {
        // --- Apply Selections to Structured Data ---
        const finalStructuredData = JSON.parse(JSON.stringify(jobData.structuredResumeData)); // Deep copy to avoid modifying original job data

        if (finalStructuredData.experience && Array.isArray(finalStructuredData.experience)) {
            finalStructuredData.experience.forEach(exp => {
                if (exp.accomplishments && Array.isArray(exp.accomplishments)) {
                    exp.accomplishments = exp.accomplishments.map(originalPoint => {
                        // If a selection exists for this original point, use it, otherwise keep original
                        return selections[originalPoint] || originalPoint;
                    });
                }
            });
        }
         // Add similar logic for other sections if they contain selectable points (e.g., projects)

        // --- Generate PDF from Structured Data ---
        const pdfDoc = await PDFDocument.create();
        let page = pdfDoc.addPage();
        let { width, height } = page.getSize();
        const margin = 50;
        const contentWidth = width - 2 * margin;
        let y = height - margin; // Start drawing from top margin

        // Embed fonts
        const helvetica = await pdfDoc.embedFont('Helvetica');
        const helveticaBold = await pdfDoc.embedFont('Helvetica-Bold');

        // Helper function to draw text and handle line breaks/page breaks
        const drawText = (text, options) => {
            const { font = helvetica, size = 11, x = margin, color = rgb(0, 0, 0), lineHeightFactor = 1.3 } = options;
            const currentLineHeight = size * lineHeightFactor;
            const sanitizedLine = (text || '').toString().replace(/[^\x00-\x7F]/g, "?"); // Basic ASCII sanitization for standard fonts

            // Simple word wrapping (can be improved)
            const words = sanitizedLine.split(' ');
            let line = '';
            for (const word of words) {
                 const testLine = line ? `${line} ${word}` : word;
                 const testWidth = font.widthOfTextAtSize(testLine, size);
                 if (testWidth < contentWidth) {
                     line = testLine;
                 } else {
                     // Draw the line that fits
                     if (y < margin + currentLineHeight) {
                         page = pdfDoc.addPage();
                         y = height - margin;
                     }
                     page.drawText(line, { x, y, font, size, color });
                     y -= currentLineHeight;
                     line = word; // Start new line
                 }
            }
             // Draw the last part
             if (y < margin + currentLineHeight) {
                 page = pdfDoc.addPage();
                 y = height - margin;
             }
             page.drawText(line, { x, y, font, size, color });
             y -= currentLineHeight;
        };

         // Helper function to add vertical space
         const moveDown = (lines = 1) => {
             y -= (11 * 1.3) * lines; // Use default line height for spacing
             if (y < margin) {
                 page = pdfDoc.addPage();
                 y = height - margin;
             }
         };

        // --- Render Sections ---

        // Name (H1)
        if (finalStructuredData.name) {
            drawText(finalStructuredData.name, { font: helveticaBold, size: 18 });
            moveDown(0.5); // Small space after name
        }

        // Contact Info
        if (finalStructuredData.contactInfo) {
            const contactParts = [];
            if (finalStructuredData.contactInfo.phone) contactParts.push(finalStructuredData.contactInfo.phone);
            if (finalStructuredData.contactInfo.email) contactParts.push(finalStructuredData.contactInfo.email);
            if (finalStructuredData.contactInfo.location) contactParts.push(finalStructuredData.contactInfo.location);
            if (finalStructuredData.contactInfo.linkedin) contactParts.push(finalStructuredData.contactInfo.linkedin);
            drawText(contactParts.join(' | '), { size: 10 }); // Compact format
            moveDown(1.5); // More space after contact
        }

        // Summary
        if (finalStructuredData.summary) {
             drawText("Summary", { font: helveticaBold, size: 14 });
             moveDown(0.3);
             drawText(finalStructuredData.summary, { size: 11 });
             moveDown(1.5);
        }

        // Experience
        if (finalStructuredData.experience && finalStructuredData.experience.length > 0) {
            drawText("Experience", { font: helveticaBold, size: 14 });
            moveDown(0.5);
            finalStructuredData.experience.forEach(exp => {
                const companyLine = `${exp.company || ''}${exp.location ? ` | ${exp.location}` : ''}${exp.dates ? ` | ${exp.dates}` : ''}`;
                drawText(companyLine, { font: helveticaBold, size: 12 });
                moveDown(0.1);
                if (exp.title) {
                    drawText(exp.title, { font: helveticaBold, size: 11 });
                    moveDown(0.3);
                }
                if (exp.accomplishments && exp.accomplishments.length > 0) {
                    exp.accomplishments.forEach(acc => {
                        drawText(`- ${acc}`, { x: margin + 10, size: 11 }); // Indent bullets
                    });
                }
                moveDown(1); // Space between experiences
            });
             moveDown(0.5); // Extra space after section
        }

        // Education
        if (finalStructuredData.education && finalStructuredData.education.length > 0) {
            drawText("Education", { font: helveticaBold, size: 14 });
            moveDown(0.5);
            finalStructuredData.education.forEach(edu => {
                 drawText(edu.institution || '', { font: helveticaBold, size: 12 });
                 moveDown(0.1);
                 const degreeLine = `${edu.degree || ''}${edu.date ? ` | ${edu.date}` : ''}`;
                 drawText(degreeLine, { size: 11 });
                 moveDown(1); // Space between education entries
            });
             moveDown(0.5);
        }

        // Skills
        if (finalStructuredData.skills) {
             drawText("Skills", { font: helveticaBold, size: 14 });
             moveDown(0.5);
             if (Array.isArray(finalStructuredData.skills)) { // Simple list
                 drawText(finalStructuredData.skills.join(', '), { size: 11 });
             } else if (typeof finalStructuredData.skills === 'object') { // Categorized
                 Object.entries(finalStructuredData.skills).forEach(([category, skillsList]) => {
                     if (skillsList && skillsList.length > 0) {
                         drawText(category, { font: helveticaBold, size: 11 });
                         moveDown(0.2);
                         drawText(skillsList.join(', '), { size: 11 });
                         moveDown(0.8);
                     }
                 });
             }
             moveDown(1.5);
        }

        // Add other sections (e.g., Projects) similarly if needed

        // --- Save and Send PDF ---
        const pdfBytes = await pdfDoc.save();

        console.log(`Generated structured PDF for job ${jobId} with size ${pdfBytes.length} bytes.`);

        // Send the PDF back
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="structured_resume.pdf"'); // New filename
        res.send(Buffer.from(pdfBytes)); // Send as Buffer

    } catch (error) {
        console.error(`Error generating structured PDF for job ${jobId}:`, error);
        res.status(500).json({ error: `Failed to generate structured PDF: ${error.message}` });
    }
});


// --- Start Server (only if run directly) ---
// Check if the current module is the main module being run
const isMainModule = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
    app.listen(port, () => {
        console.log(`Backend server running at http://localhost:${port}`);
    });
}

// Export app for testing AND helper functions for mocking in tests
export { app as default, readData, writeData };
