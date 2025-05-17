import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import './App.css';
// Helper for triggering file download
import FileSaver from 'file-saver';

// --- Component Imports ---
import RoleManager from './RoleManager';
import JdManager from './JdManager';
import KeywordSummary from './KeywordSummary';
import ResumeCustomizer from './ResumeCustomizer'; // Import the new component


// --- API URLs ---
const RESUME_API_URL = 'http://localhost:3001/api/suggest';
const ROLES_API_URL = 'http://localhost:3001/api/roles';
const JDS_API_URL = 'http://localhost:3001/api/jds';
const CUSTOMIZE_API_URL = 'http://localhost:3001/api/customize-resume';
const GENERATE_PDF_API_URL = 'http://localhost:3001/api/generate-edited-pdf'; // New endpoint


function App() {
  // --- State for Module Selection ---
  const [currentModule, setCurrentModule] = useState('resume'); // 'resume', 'jd', or 'customizer'

  // --- State for Resume Reader ---
  const [resumeFileContent, setResumeFileContent] = useState('');
  const [resumeResults, setResumeResults] = useState([]);
  const [resumeIsLoading, setResumeIsLoading] = useState(false);
  const [resumeError, setResumeError] = useState(null);
  const [resumeStatusMessage, setResumeStatusMessage] = useState('');
  const resumeFileInputRef = useRef(null);

  // --- State for JD Analyzer ---
  const [selectedRoleId, setSelectedRoleId] = useState(null); // Used by JD Analyzer module

  // --- State for Resume Customizer (Lifted) ---
  const [customizerRoles, setCustomizerRoles] = useState([]);
  const [customizerSelectedRole, setCustomizerSelectedRole] = useState('');
  const [customizerSelectedFile, setCustomizerSelectedFile] = useState(null);
  const [customizerIsLoading, setCustomizerIsLoading] = useState(false); // Will now indicate initial request + streaming phase
  const [customizerResults, setCustomizerResults] = useState(null); // Will store initial context + final processed points array
  const [customizerStreamingResults, setCustomizerStreamingResults] = useState([]); // Store points as they arrive
  const [customizerProgress, setCustomizerProgress] = useState(null); // { current: number, total: number, message: string }
  const [customizerError, setCustomizerError] = useState('');
  const [customizerSelectionType, setCustomizerSelectionType] = useState('role');
  const [customizerAvailableJds, setCustomizerAvailableJds] = useState([]);
  const [customizerSelectedJd, setCustomizerSelectedJd] = useState('');
  const [customizerJdSummary, setCustomizerJdSummary] = useState(null);
  const [currentJobId, setCurrentJobId] = useState(null); // Store the current customization job ID
  // State to hold the actual text content of all options
  const [allOptionTexts, setAllOptionTexts] = useState({});
  // { [originalPoint]: { original: string, suggestions: string[] } }
  // State to track which option is selected via radio button
  const [selectedOptionInfo, setSelectedOptionInfo] = useState({});
  // { [originalPoint]: { type: 'original' | 'suggestion', index?: number } }
  const [editingPointKey, setEditingPointKey] = useState(null); // Tracks which specific option is being edited (e.g., "originalPoint::original" or "originalPoint::suggestion::index")
  const [tempEditValue, setTempEditValue] = useState(''); // Holds the value while textarea is active
  const eventSourceRef = useRef(null); // Ref to hold the EventSource instance


  // --- Fetch Initial Data for Customizer ---
  useEffect(() => {
    let isMounted = true; // Flag to prevent state updates on unmounted component

    const fetchCustomizerData = async () => {
      // Don't set loading here, as it might affect other modules if App loads slowly
      // setCustomizerIsLoading(true);
      setCustomizerError(''); // Clear previous errors on app load/refresh
      try {
        // Fetch Roles for Customizer
        const rolesResponse = await axios.get(ROLES_API_URL);
        if (isMounted && rolesResponse.data) {
          const fetchedRoles = rolesResponse.data || [];
          setCustomizerRoles(fetchedRoles);
          if (fetchedRoles.length > 0 && !customizerSelectedRole) {
             // Set default only if not already set (e.g., by previous interaction)
            setCustomizerSelectedRole(fetchedRoles[0].id);
          }
        }

        // Fetch Completed JDs for Customizer
        const jdsResponse = await axios.get(JDS_API_URL);
        if (isMounted && jdsResponse.data) {
          const fetchedJds = jdsResponse.data || [];
          setCustomizerAvailableJds(fetchedJds);
           if (fetchedJds.length > 0 && !customizerSelectedJd) {
             // Set default only if not already set
            setCustomizerSelectedJd(fetchedJds[0].id);
          }
        }

      } catch (err) {
        console.error("Error fetching initial customizer data:", err);
        if (isMounted) {
          // Set error specific to customizer state
          setCustomizerError('Failed to fetch initial data for customizer.');
        }
      } finally {
        // if (isMounted) {
        //   setCustomizerIsLoading(false); // Stop loading indicator
        // }
      }
    };

    fetchCustomizerData();

    return () => {
      isMounted = false; // Cleanup on unmount
    };
    // Run only once on App mount
  }, []); // Empty dependency array


  // --- Handlers for Resume Reader ---
  const handleResumeFileChange = (event) => {
    const file = event.target.files[0];
    if (!file) {
      setResumeFileContent('');
      setResumeStatusMessage('');
      setResumeResults([]);
      setResumeError(null);
      return;
    }

    if (file.type !== 'text/plain') {
      setResumeError('Please select a .txt file.');
      setResumeFileContent('');
      setResumeResults([]);
      if (resumeFileInputRef.current) {
        resumeFileInputRef.current.value = '';
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      setResumeFileContent(e.target.result);
      setResumeError(null);
      setResumeResults([]);
      setResumeStatusMessage(`File "${file.name}" loaded. Ready to process.`);
    };
    reader.onerror = (e) => {
      console.error("File reading error:", e);
      setResumeError('Error reading the selected file.');
      setResumeFileContent('');
      setResumeResults([]);
      setResumeStatusMessage('');
    };
    reader.readAsText(file);
  };

  // Handle button click to process the resume
  const handleResumeProcessClick = async () => {
    if (!resumeFileContent) {
      setResumeError('Please select and load a file first.');
      return;
    }

    setResumeIsLoading(true);
    setResumeError(null);
    setResumeResults([]);
    setResumeStatusMessage('Processing resume points...');

    const points = resumeFileContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('-'))
      .map(line => line.substring(1).trim()); // Remove '-' and trim

    if (points.length === 0) {
      setResumeError('No resume points found in the file (ensure lines start with "-").');
      setResumeIsLoading(false);
      setResumeStatusMessage('');
      return;
    }

    const newResults = [];
    let encounteredError = false;

    // Process each point sequentially by calling the backend
    for (const point of points) {
      if (!point) continue; // Skip empty points after trimming

      try {
        setResumeStatusMessage(`Processing: "${point.substring(0, 50)}..."`);
        const response = await fetch(RESUME_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ point }), // Send point in request body
        });

        const data = await response.json();

        if (!response.ok) {
          // Handle errors from the backend API
          console.error('Backend API error:', data);
          throw new Error(data.error || `Request failed with status ${response.status}`);
        }

        newResults.push({ original: point, suggestions: data.suggestions || [] });

      } catch (err) {
        console.error(`Error processing point "${point}":`, err);
        // Store error alongside results for this point
        newResults.push({ original: point, error: err.message || 'Failed to get suggestions.' });
        encounteredError = true;
        // Continue processing other points even if one fails
      }
    }

    setResumeResults(newResults);
    setResumeIsLoading(false);
    setResumeStatusMessage(encounteredError ? 'Finished processing with some errors.' : 'Processing complete.');
  };

  // --- Handlers for JD Analyzer ---
  // (Keep existing handlers if any, or add as needed)

  // --- Cleanup SSE connection on unmount or module change ---
  useEffect(() => {
    // Return a cleanup function
    return () => {
      if (eventSourceRef.current) {
        console.log("Closing SSE connection due to component unmount or module change.");
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []); // Empty dependency array ensures this runs only on mount and unmount


  // --- Handlers for Resume Customizer (Lifted) ---
  const handleCustomizerFileChange = (event) => {
    setCustomizerSelectedFile(event.target.files[0]);
    setCustomizerResults(null); // Clear previous full results
    setCustomizerStreamingResults([]); // Clear streaming results
    setCustomizerJdSummary(null);
    setCustomizerProgress(null);
    setCustomizerError('');
    setCurrentJobId(null); // Clear job ID
    setSelectedOptionInfo({}); // Clear selections
    setAllOptionTexts({}); // Clear stored texts
     // Close any existing SSE connection if file changes mid-stream
     if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setCustomizerIsLoading(false); // Reset loading if connection is closed here
     }
  };

  // Wrap state setters that clear results in useCallback to avoid unnecessary re-renders if passed down
  const handleCustomizerRoleChange = useCallback((event) => {
    setCustomizerSelectedRole(event.target.value);
    setCustomizerResults(null);
    setCustomizerStreamingResults([]);
    setCustomizerJdSummary(null);
    setCustomizerProgress(null);
    setCustomizerError('');
    setCurrentJobId(null); // Clear job ID
    setSelectedOptionInfo({}); // Clear selections
    setAllOptionTexts({}); // Clear stored texts
  }, []);

  const handleCustomizerJdChange = useCallback((event) => {
    setCustomizerSelectedJd(event.target.value);
    setCustomizerResults(null);
    setCustomizerStreamingResults([]);
    setCustomizerJdSummary(null);
    setCustomizerProgress(null);
    setCustomizerError('');
    setCurrentJobId(null); // Clear job ID
    setSelectedOptionInfo({}); // Clear selections
    setAllOptionTexts({}); // Clear stored texts
  }, []);

  const handleCustomizerSelectionTypeChange = useCallback((event) => {
    setCustomizerSelectionType(event.target.value);
    setCustomizerResults(null);
    setCustomizerStreamingResults([]);
    setCustomizerJdSummary(null);
    setCustomizerProgress(null);
    setCustomizerError('');
    setCurrentJobId(null); // Clear job ID
    setSelectedOptionInfo({}); // Clear selections
    setAllOptionTexts({}); // Clear stored texts
  }, []);


  // --- SSE Handler Logic ---
  const handleCustomizerSubmit = async (event) => {
    event.preventDefault();

    // Validation based on selection type
    if (customizerSelectionType === 'role' && !customizerSelectedRole) {
      setCustomizerError('Please select a target role.');
      return;
    }
    if (customizerSelectionType === 'jd' && !customizerSelectedJd) {
      setCustomizerError('Please select a specific Job Description.');
      return;
    }
    if (!customizerSelectedFile) {
      setCustomizerError('Please upload a resume PDF file.');
      return;
    }
     if (customizerSelectedFile.type !== 'application/pdf') {
       setCustomizerError('Please upload a PDF file.');
       return;
     }

    // Close any existing connection before starting a new one
    if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
    }

    setCustomizerIsLoading(true); // Indicate processing started
    setCustomizerError('');
    setCustomizerResults(null); // Clear previous full results object
    setCustomizerStreamingResults([]); // Clear previous streaming results
    setCustomizerJdSummary(null);
    setCustomizerProgress({ current: 0, total: 0, message: 'Initiating analysis...' }); // Initial progress

    const formData = new FormData();
    formData.append('resumePdf', customizerSelectedFile);

    // Append either roleId or jdId based on selectionType
    if (customizerSelectionType === 'role') {
      formData.append('roleId', customizerSelectedRole);
    } else {
      formData.append('jdId', customizerSelectedJd);
    }

    try {
      // 1. Make the initial request to start the job
      const initialResponse = await axios.post(CUSTOMIZE_API_URL, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      // Expecting 202 Accepted with jobId
      if (initialResponse.status !== 202 || !initialResponse.data.jobId) {
        throw new Error('Backend did not initiate processing correctly.');
      }

      const { jobId, analysisContext, contextName, jdAnalysisSummary: initialJdSummary } = initialResponse.data;
      console.log(`Processing started with Job ID: ${jobId}`);
      setCurrentJobId(jobId); // Store the job ID

      // Store initial context immediately
      setCustomizerResults({ analysisContext, contextName }); // Store context, points will stream
      setSelectedOptionInfo({}); // Reset selections for the new job
      setAllOptionTexts({}); // Reset texts for the new job
      if (initialJdSummary) {
        setCustomizerJdSummary(initialJdSummary);
      }
      setCustomizerProgress({ current: 0, total: 0, message: 'Connecting to stream...' });


      // 2. Establish SSE connection
      const sseUrl = `http://localhost:3001/api/customize-stream/${jobId}`; // Ensure correct backend URL
      const eventSource = new EventSource(sseUrl);
      eventSourceRef.current = eventSource; // Store ref

      eventSource.onopen = () => {
        console.log(`SSE connection opened for job ${jobId}`);
        setCustomizerProgress(prev => ({ ...prev, message: 'Stream connected. Processing points...' }));
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("SSE message received:", data);

          switch (data.type) {
            case 'point_processed':
              // Add the new point to streaming results
              setCustomizerStreamingResults(prevResults => [...prevResults, data.payload]);

              // Initialize both states for this point
              const { original, suggestions = [], isDefault, error } = data.payload;

              // 1. Initialize allOptionTexts
              setAllOptionTexts(prevTexts => ({
                  ...prevTexts,
                  [original]: {
                      original: original, // Store original text
                      suggestions: suggestions // Store initial suggestions array
                  }
              }));

              // 2. Initialize selectedOptionInfo (the choice)
              setSelectedOptionInfo(prevInfo => {
                  let initialChoice = { type: 'original' }; // Default choice is original
                  if (!error && suggestions.length > 0 && isDefault) {
                      initialChoice = { type: 'suggestion', index: 0 }; // Default choice is first suggestion
                  }
                  return {
                      ...prevInfo,
                      [original]: initialChoice
                  };
              });

              // Update progress based on received points if total is known
              setCustomizerProgress(prev => ({
                  ...prev,
                  current: prev?.current ? prev.current + 1 : 1, // Increment count
                  message: `Processed point ${prev?.current ? prev.current + 1 : 1}${prev?.total ? ` of ${prev.total}` : ''}...`
              }));
              break;
            case 'progress':
               // Update progress state with current/total if provided
               setCustomizerProgress(data.payload);
               break;
            case 'done':
              console.log(`SSE Job ${jobId} done:`, data.payload.message);
              setCustomizerIsLoading(false); // Processing finished
              setCustomizerProgress(prev => ({ ...prev, message: data.payload.message || 'Processing complete.' }));
              eventSource.close(); // Close connection on done
              eventSourceRef.current = null;
              // Optionally, consolidate streaming results into the main results object here if needed
              // setCustomizerResults(prev => ({ ...prev, processedPoints: customizerStreamingResults }));
              break;
            case 'error':
              console.error(`SSE Job ${jobId} error:`, data.payload.message);
              setCustomizerError(`Processing error: ${data.payload.message}`);
              setCustomizerIsLoading(false);
              setCustomizerProgress(null);
              eventSource.close();
              eventSourceRef.current = null;
              break;
             case 'connected':
                 console.log(`SSE Job ${jobId} connected:`, data.payload.message);
                 setCustomizerProgress(prev => ({ ...prev, message: data.payload.message || 'Stream connected.' }));
                 break;
            default:
              console.warn(`Unknown SSE event type: ${data.type}`);
          }
        } catch (parseError) {
          console.error("Failed to parse SSE message data:", event.data, parseError);
        }
      };

      eventSource.onerror = (error) => {
        console.error(`SSE connection error for job ${jobId}:`, error);
        setCustomizerError('Stream connection failed or was interrupted.');
        setCustomizerIsLoading(false);
        setCustomizerProgress(null);
        if (eventSourceRef.current) {
             eventSourceRef.current.close(); // Ensure closure on error
             eventSourceRef.current = null;
        }
      };

    } catch (err) {
      // Handle errors from the initial POST request
      console.error("Error initiating resume customization:", err);
      const errorMsg = err.response?.data?.error || err.message || 'Failed to start customization process.';
      setCustomizerError(errorMsg);
      setCustomizerIsLoading(false); // Ensure loading is stopped on initial error
      setCustomizerProgress(null);
      // Ensure any potentially opened SSE connection is closed
       if (eventSourceRef.current) {
           eventSourceRef.current.close();
           eventSourceRef.current = null;
       }
    }
    // Note: No finally block needed here as loading state is managed within try/catch and SSE events
  };

  // Handler for changing selection via RADIO BUTTON - Updates only the choice
  const handlePointSelectionChange = useCallback((originalPoint, type, index) => {
      setSelectedOptionInfo(prevInfo => ({
          ...prevInfo,
          [originalPoint]: { type, index } // Store the choice info
      }));
      setEditingPointKey(null); // Close any open editor
      setTempEditValue(''); // Clear temp value
  }, []);

  // Handler for opening/closing the editor - Initializes temp value from allOptionTexts
  const handleSetEditingPoint = useCallback((key, originalPoint = null, type = null, index = null) => {
      setEditingPointKey(key);
      if (key !== null && originalPoint !== null && allOptionTexts[originalPoint]) {
          // Initialize temp value with the current text of the specific option being edited
          let initialText = '';
          if (type === 'original') {
              initialText = allOptionTexts[originalPoint].original;
          } else if (type === 'suggestion' && allOptionTexts[originalPoint].suggestions && index !== null) {
              initialText = allOptionTexts[originalPoint].suggestions[index] || '';
          }
          setTempEditValue(initialText);
      } else {
          // Clear temp value when closing editor
          setTempEditValue('');
      }
  }, [allOptionTexts]); // Dependency on allOptionTexts to get the initial value

  // Handler for updating the temporary text in the TEXTAREA
  const handlePointEditChange = useCallback((newValue) => {
      setTempEditValue(newValue); // Only update the temporary state
  }, []);

  // Handler for saving the edited text from TEXTAREA - Updates allOptionTexts
  const handleSavePointEdit = useCallback((originalPoint, type, index) => {
      setAllOptionTexts(prevTexts => {
          const pointData = prevTexts[originalPoint];
          if (!pointData) return prevTexts; // Should not happen

          let updatedSuggestions = pointData.suggestions;
          let updatedOriginal = pointData.original;

          if (type === 'original') {
              updatedOriginal = tempEditValue;
          } else if (type === 'suggestion' && index !== null && pointData.suggestions) {
              // Create a new array for suggestions to ensure state update
              updatedSuggestions = [...pointData.suggestions];
              if (index >= 0 && index < updatedSuggestions.length) {
                  updatedSuggestions[index] = tempEditValue;
              }
          }

          return {
              ...prevTexts,
              [originalPoint]: {
                  original: updatedOriginal,
                  suggestions: updatedSuggestions
              }
          };
      });
      setEditingPointKey(null); // Close editor
      setTempEditValue(''); // Clear temp value
  }, [tempEditValue]); // Dependency on tempEditValue to save the correct data

  // Handler for triggering PDF generation
  const handleGeneratePdfClick = useCallback(async () => {
      if (!currentJobId) {
          setCustomizerError("No active customization job found to generate PDF from.");
          return;
      }
      if (Object.keys(selectedOptionInfo).length === 0) {
          setCustomizerError("No selections available to generate PDF.");
          return;
      }

      setCustomizerIsLoading(true); // Indicate PDF generation is in progress
      setCustomizerError('');

      // Prepare selections payload by looking up the chosen text from allOptionTexts based on selectedOptionInfo
      const selectionsPayload = Object.entries(selectedOptionInfo).reduce((acc, [originalPoint, info]) => {
          const texts = allOptionTexts[originalPoint];
          if (!texts) return acc; // Skip if text data is missing for some reason

          if (info.type === 'original') {
              acc[originalPoint] = texts.original;
          } else if (info.type === 'suggestion' && info.index !== undefined && texts.suggestions) {
              acc[originalPoint] = texts.suggestions[info.index] || ''; // Use selected suggestion text
          } else {
              acc[originalPoint] = texts.original; // Fallback to original if info is invalid
          }
          return acc;
      }, {});


      try {
          const response = await axios.post(GENERATE_PDF_API_URL, {
              jobId: currentJobId,
              selections: selectionsPayload // Send the simplified payload
          }, {
              responseType: 'blob', // Important: Expect a binary blob response
          });

          // Use FileSaver to trigger download
          FileSaver.saveAs(response.data, 'edited_resume.pdf');
          console.log("PDF generated and download triggered.");

      } catch (err) {
          console.error("Error generating PDF:", err);
          // Attempt to read error message from blob if backend sent JSON error
          let errorMsg = 'Failed to generate PDF.';
          if (err.response && err.response.data instanceof Blob && err.response.data.type === 'application/json') {
              try {
                  const errorJson = JSON.parse(await err.response.data.text());
                  errorMsg = errorJson.error || errorMsg;
              } catch (parseErr) {
                  console.error("Could not parse error blob:", parseErr);
              }
          } else if (err.response?.data?.error) {
               errorMsg = err.response.data.error;
          } else if (err.message) {
               errorMsg = err.message;
          }
          setCustomizerError(errorMsg);
      } finally {
          setCustomizerIsLoading(false); // Stop loading indicator
      }
  }, [currentJobId, selectedOptionInfo, allOptionTexts]); // Dependencies: jobId, the selection choices, and the text data


  // --- Render Logic ---
  const renderResumeReader = () => (
    <>
      <h2>Resume Bullet Point Enhancer</h2>
      <p>Upload your resume (.txt format, points starting with '-') and click "Process" to get AI-powered suggestions.</p>
      <div className="input-section">
        <label htmlFor="resumeFile">1. Upload Resume (.txt):</label>
        <input
          type="file"
          id="resumeFile"
          accept=".txt"
          onChange={handleResumeFileChange}
          ref={resumeFileInputRef}
          disabled={resumeIsLoading}
        />
        <button onClick={handleResumeProcessClick} disabled={resumeIsLoading || !resumeFileContent}>
          {resumeIsLoading ? 'Processing...' : 'Process Resume'}
        </button>
      </div>
      {resumeError && <p className="error-message">{resumeError}</p>}
      {resumeStatusMessage && !resumeError && <p className="status-message">{resumeStatusMessage}</p>}
      {resumeResults.length > 0 && (
        <div className="output-section">
          <h3>Suggestions:</h3>
          {resumeResults.map((result, index) => (
            <div key={index} className="suggestion-block">
              <p className="original-point">Original: {result.original}</p>
              {/* Display suggestions if they exist */}
              {result.suggestions && result.suggestions.map((suggestion, sIndex) => (
                <div key={sIndex} className="suggestion">
                  <span>Suggestion {sIndex + 1}: {suggestion}</span>
                  <button
                    className="copy-button" // Add class for styling
                    onClick={() => navigator.clipboard.writeText(suggestion)}
                    title="Copy suggestion" // Add tooltip
                  >
                    Copy
                  </button>
                </div>
              ))}
              {/* Display error specific to this point if it occurred */}
              {result.error && (
                 <p className="error-message">Error: {result.error}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );

  const renderJdAnalyzer = () => (
    <>
      <h2>JD Analyzer & Keyword Extractor</h2>
      <p>Manage roles, add job description URLs, analyze them, and view keyword summaries.</p>
      {/* Placeholder for JD Analyzer Components */}
      <div style={{ border: '1px dashed #ccc', padding: '20px', marginTop: '20px', color: '#aaa' }}>
        <RoleManager
          selectedRoleId={selectedRoleId}
          onRoleSelect={setSelectedRoleId} // Pass setter function down
        />
        {/* Conditionally render JDManager and KeywordSummary based on selectedRoleId */}
        {selectedRoleId && (
          <>
            <JdManager selectedRoleId={selectedRoleId} />
            <KeywordSummary selectedRoleId={selectedRoleId} />
          </>
        )}
      </div>
    </>
  );

  const renderResumeCustomizer = () => (
    <ResumeCustomizer
      // Pass state down (including new streaming state)
      roles={customizerRoles}
      selectedRole={customizerSelectedRole}
      selectedFile={customizerSelectedFile}
      isLoading={customizerIsLoading}
      results={customizerResults} // Contains initial context
      streamingResults={customizerStreamingResults} // Array of processed points
      progress={customizerProgress} // Progress info
      error={customizerError}
      selectionType={customizerSelectionType}
      availableJds={customizerAvailableJds}
      selectedJd={customizerSelectedJd}
      jdAnalysisSummary={customizerJdSummary} // Initial JD summary
      // Pass handlers down
      onFileChange={handleCustomizerFileChange}
      onRoleChange={handleCustomizerRoleChange}
      onJdChange={handleCustomizerJdChange}
      onSelectionTypeChange={handleCustomizerSelectionTypeChange}
      onSubmit={handleCustomizerSubmit}
      // Pass new state and handlers
      allOptionTexts={allOptionTexts} // Pass the texts
      selectedOptionInfo={selectedOptionInfo} // Pass the selection info
      onPointSelectionChange={handlePointSelectionChange} // Pass updated handler
      onGeneratePdf={handleGeneratePdfClick} // Pass updated handler
      currentJobId={currentJobId}
      // Props for inline editing
      editingPointKey={editingPointKey}
      tempEditValue={tempEditValue}
      onSetEditingPoint={handleSetEditingPoint} // Pass updated handler
      onPointEditChange={handlePointEditChange} // Pass updated handler
      onSavePointEdit={handleSavePointEdit} // Pass updated handler
    />
  );


  return (
    // Changed main container class to app-layout
    <div className="app-layout">
      {/* Sidebar */}
      <div className="app-sidebar">
        <h1>AI Assistant</h1>
        <nav className="module-nav">
          <button
            onClick={() => setCurrentModule('resume')}
          disabled={currentModule === 'resume'}
          className={currentModule === 'resume' ? 'active' : ''}
        >
          Resume Reader
        </button>
        <button
          onClick={() => setCurrentModule('jd')}
          disabled={currentModule === 'jd'}
          className={currentModule === 'jd' ? 'active' : ''}
        >
            JD Analyzer
          </button>
          <button
            onClick={() => setCurrentModule('customizer')}
            disabled={currentModule === 'customizer'}
            className={currentModule === 'customizer' ? 'active' : ''}
          >
            Resume Customizer
          </button>
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="app-content">
        {/* Render selected module */}
        {currentModule === 'resume' && renderResumeReader()}
        {currentModule === 'jd' && renderJdAnalyzer()}
        {currentModule === 'customizer' && renderResumeCustomizer()}
      </div>
    </div>
  );
}

export default App;
