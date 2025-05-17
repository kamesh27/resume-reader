import { useState } from 'react';
import './App.css';

// NOTE: Removed TypeScript interfaces. Structure is implied by usage.

function App() {
  const [resumeData, setResumeData] = useState(null); // No type annotation
  const [fileName, setFileName] = useState('');
  const [parsingError, setParsingError] = useState(null);
  const [suggestions, setSuggestions] = useState({}); // No type annotation

  // --- Parsing Logic ---
  const parseResumeText = (text) => { // No type annotations
    const lines = text.split('\n').map(line => line.trim());
    const data = { summary: '', jobs: [] }; // No type annotation
    let currentJob = null; // No type annotation
    let readingSection = null; // No type annotation

    for (const line of lines) {
      if (line.toLowerCase().startsWith('section: summary')) {
        readingSection = 'summary';
        data.summary = ''; // Reset summary
        continue;
      } else if (line.toLowerCase().startsWith('-- job')) {
        if (currentJob) {
          data.jobs.push(currentJob); // Save previous job
        }
        currentJob = { // Initialize new job
          title: '', company: '', startMonth: '', startYear: '',
          endMonth: '', endYear: '', currentlyWorking: false, points: []
        };
        readingSection = 'job_details';
        continue;
      }

      if (readingSection === 'summary') {
        if (line.toLowerCase().startsWith('-- job')) {
           readingSection = 'job_details';
           if (currentJob) data.jobs.push(currentJob);
           currentJob = { title: '', company: '', startMonth: '', startYear: '', endMonth: '', endYear: '', currentlyWorking: false, points: [] };
           continue;
        }
        const summaryContent = line.replace(/^Summary:\s*/i, '').trim();
        if (summaryContent) {
             data.summary += (data.summary ? '\n' : '') + summaryContent;
        }

      } else if (readingSection === 'job_details' && currentJob) {
        if (line.toLowerCase().startsWith('points:')) {
          readingSection = 'job_points';
          continue;
        }
        const parts = line.split(':');
        if (parts.length > 1) {
          const key = parts[0].trim().toLowerCase();
          const value = parts.slice(1).join(':').trim();

          switch (key) {
            case 'title': currentJob.title = value; break;
            case 'company': currentJob.company = value; break;
            case 'start month': currentJob.startMonth = value; break;
            case 'start year': currentJob.startYear = value; break;
            case 'end month': currentJob.endMonth = value; break;
            case 'end year': currentJob.endYear = value; break;
            case 'currently in this job':
              currentJob.currentlyWorking = ['yes', 'true'].includes(value.toLowerCase());
              break;
          }
        }
      } else if (readingSection === 'job_points' && currentJob) {
         if (line.startsWith('-')) {
            const pointText = line.substring(1).trim();
            if (pointText) {
                currentJob.points.push(pointText);
            }
         } else if (line.toLowerCase().startsWith('-- job')) {
             readingSection = 'job_details';
             if (currentJob) data.jobs.push(currentJob);
             currentJob = { title: '', company: '', startMonth: '', startYear: '', endMonth: '', endYear: '', currentlyWorking: false, points: [] };
             continue;
         }
      }
    }

    if (currentJob) {
      data.jobs.push(currentJob);
    }

    if (!data.summary && data.jobs.length === 0) {
        throw new Error("Could not parse any Summary or Job sections. Please check the file format.");
    }
     if (data.jobs.some(job => !job.title || !job.company)) {
         console.warn("Some jobs might be missing title or company.");
     }
     if (data.jobs.some(job => job.points.length === 0)) {
         console.warn("Some jobs have no points listed.");
     }

    return data;
  };

  // --- Event Handlers ---
  const handleFileChange = (event) => { // No type annotation
    const file = event.target.files?.[0];
    setResumeData(null);
    setFileName('');
    setParsingError(null);
    setSuggestions({});

    if (file) {
      setFileName(file.name);
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const text = e.target?.result; // No 'as string'
          if (!text) {
              throw new Error("File is empty or could not be read.");
          }
          const parsedData = parseResumeText(text);
          setResumeData(parsedData);
        } catch (error) { // No ': any'
          console.error("Parsing error:", error);
          setParsingError(`Failed to parse resume: ${error.message || 'Unknown error'}`);
          setResumeData(null);
        }
      };

      reader.onerror = (e) => {
        console.error("File reading error:", e);
        setParsingError('Failed to read the file.');
        setResumeData(null);
      };

      reader.readAsText(file);
    }
     event.target.value = '';
  };

  const handleGetSuggestions = async (point) => { // No type annotation
    if (suggestions[point]?.loading) return;

    setSuggestions(prev => ({
      ...prev,
      [point]: { loading: true, suggestions: [], error: null }
    }));

    try {
      const response = await fetch('http://localhost:3001/api/suggest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ point: point }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      setSuggestions(prev => ({
        ...prev,
        [point]: { loading: false, suggestions: data.suggestions || [], error: null }
      }));

    } catch (error) { // No ': any'
      console.error('Error fetching suggestions:', error);
      setSuggestions(prev => ({
        ...prev,
        [point]: { loading: false, suggestions: [], error: error.message || 'Failed to fetch suggestions' }
      }));
    }
  };

  // --- Rendering ---
  return (
    <div className="App">
      <h1>Resume Point Enhancer</h1>

      <div className="upload-section">
        <label htmlFor="resumeFile" className="file-label">Upload Resume (.txt):</label>
        <input
          type="file"
          id="resumeFile"
          accept=".txt"
          onChange={handleFileChange}
        />
        {fileName && <p className="file-name">Selected: {fileName}</p>}
      </div>

      {parsingError && <p className="error-message">Error: {parsingError}</p>}

      {resumeData && (
        <div className="resume-display">
          {resumeData.summary && (
            <div className="resume-section">
              <h2>Summary</h2>
              <p className="summary-text">{resumeData.summary.split('\n').map((line, i) => <span key={i}>{line}<br/></span>)}</p>
            </div>
          )}

          {resumeData.jobs.map((job, jobIndex) => (
            <div key={jobIndex} className="resume-section job-section">
              <h2>Job Experience {jobIndex + 1}</h2>
              <p><strong>Title:</strong> {job.title}</p>
              <p><strong>Company:</strong> {job.company}</p>
              <p>
                <strong>Dates:</strong> {job.startMonth} {job.startYear} -{' '}
                {job.currentlyWorking ? 'Present' : `${job.endMonth || ''} ${job.endYear || ''}`}
              </p>

              <h3>Points:</h3>
              <ul className="points-list">
                {job.points.map((point, pointIndex) => (
                  <li key={pointIndex} className="point-item">
                    <p className="original-point"><strong>Original:</strong> {point}</p>
                    <button
                      onClick={() => handleGetSuggestions(point)}
                      disabled={suggestions[point]?.loading}
                      className="suggest-button"
                    >
                      {suggestions[point]?.loading ? 'Getting Suggestions...' : 'Get Suggestions'}
                    </button>
                    {suggestions[point] && !suggestions[point].loading && (
                      <div className="suggestions-result">
                        {suggestions[point].error && (
                          <p className="error-message">Error: {suggestions[point].error}</p>
                        )}
                        {suggestions[point].suggestions.length > 0 && (
                          <div className="suggestions-list">
                            <strong>Suggestions:</strong>
                            <ul>
                              {suggestions[point].suggestions.map((s, sIndex) => (
                                <li key={sIndex}>{s}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                         {suggestions[point].suggestions.length === 0 && !suggestions[point].error && (
                             <p>No suggestions generated for this point.</p>
                         )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
               {job.points.length === 0 && <p>No points listed for this job.</p>}
            </div>
          ))}
           {resumeData.jobs.length === 0 && !resumeData.summary && (
               <p>No resume content found after parsing.</p>
           )}
        </div>
      )}
    </div>
  );
}

export default App;
