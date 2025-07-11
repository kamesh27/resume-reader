# Resume Reader

This project is a resume analysis tool that helps users tailor their resumes to specific job descriptions. It extracts keywords from a job description and a resume, compares them, and provides a summary to help users optimize their resume for a particular role.

## Platform Structure

The application is built with a modern web stack, featuring a separate frontend and backend.

*   **Backend:** The backend is a Node.js application using the Express framework. It handles file uploads (resumes and job descriptions), PDF parsing, and communication with the Google Generative AI API to perform the analysis.
*   **Frontend:** The frontend is a single-page application built with React and Vite. It provides a user-friendly interface for uploading documents, managing job roles, and viewing the analysis results.

## How to Interact with the Platform

1.  **Upload Job Description:** Start by uploading a PDF of the job description for the role you are interested in.
2.  **Upload Your Resume:** Upload your current resume in PDF format.
3.  **Analysis:** The application will process both documents, extract relevant keywords, and provide a comparison.
4.  **Customize:** Use the feedback to customize your resume, then re-upload it to see the improved score.

## Installation Guidelines

To get the project up and running on your local machine, follow these steps.

### Prerequisites

*   Node.js and npm (or yarn) installed on your system.
*   A `.env` file in the `backend` directory with your Google Generative AI API key. Create a file named `.env` in the `backend` directory and add the following line:
    ```
    API_KEY=YOUR_API_KEY
    ```

### Backend Setup

1.  **Navigate to the backend directory:**
    ```bash
    cd backend
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Start the server:**
    ```bash
    npm start
    ```
    The backend server will be running on `http://localhost:5000`.

### Frontend Setup

1.  **Navigate to the frontend directory:**
    ```bash
    cd frontend
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Start the development server:**
    ```bash
    npm run dev
    ```
    The frontend application will be accessible at `http://localhost:5173`.

Now you can open your browser and navigate to `http://localhost:5173` to use the application.
