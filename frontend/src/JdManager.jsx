import React, { useState, useEffect, useCallback, useRef } from 'react';

// Define API URLs (adjust if needed)
const API_BASE_URL = 'http://localhost:3001/api';

function JdManager({ selectedRoleId }) {
  const [jds, setJds] = useState([]);
  const [newJdUrl, setNewJdUrl] = useState('');
  const [newJdFile, setNewJdFile] = useState(null); // State for selected file
  const [isLoading, setIsLoading] = useState(false); // Loading JDs list
  const [addLoading, setAddLoading] = useState(false); // Loading for adding URL or File
  const [analyzeLoading, setAnalyzeLoading] = useState({});
  const [deleteLoading, setDeleteLoading] = useState({}); // Loading for deleting a specific JD
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null); // Ref for the file input

  // Fetch JDs when selectedRoleId changes
  const fetchJds = useCallback(async () => {
    if (!selectedRoleId) {
      setJds([]); // Clear JDs if no role is selected
      return;
    }
    setIsLoading(true);
    setError(null);
    setAnalyzeLoading({}); // Reset analysis loading states
    try {
      const response = await fetch(`${API_BASE_URL}/roles/${selectedRoleId}/jds`);
      if (!response.ok) {
        throw new Error(`Failed to fetch JDs: ${response.statusText}`);
      }
      const data = await response.json();
      setJds(data || []);
    } catch (err) {
      console.error(`Error fetching JDs for role ${selectedRoleId}:`, err);
      setError(err.message || 'Failed to load JDs.');
      setJds([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedRoleId]);

  useEffect(() => {
    fetchJds();
  }, [fetchJds]);


  // Handle file input change
  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file && file.type === 'application/pdf') {
        setNewJdFile(file);
        setNewJdUrl(''); // Clear URL if file is selected
        setError(null);
    } else if (file) {
        setError('Invalid file type. Please select a PDF.');
        setNewJdFile(null);
        if (fileInputRef.current) fileInputRef.current.value = ''; // Clear input visually
    } else {
        setNewJdFile(null); // Clear file state if selection is cancelled
    }
  };

   // Handle URL input change
   const handleUrlChange = (event) => {
       setNewJdUrl(event.target.value);
       if (event.target.value) {
           setNewJdFile(null); // Clear file if URL is typed
           if (fileInputRef.current) fileInputRef.current.value = ''; // Clear file input visually
       }
   };


  // Handle adding a new JD (URL or File)
  const handleAddJd = async (event) => {
    event.preventDefault();
    if (!selectedRoleId) {
        setError('No role selected.');
        return;
    }
    if (!newJdUrl.trim() && !newJdFile) {
      setError('Please enter a valid URL or select a PDF file.');
      return;
    }

    setAddLoading(true);
    setError(null);
    try {
        let response;
        let endpoint;
        let body;
        let headers = {};

        if (newJdFile) {
            // --- Handle File Upload ---
            endpoint = `${API_BASE_URL}/roles/${selectedRoleId}/jds/upload`;
            const formData = new FormData();
            formData.append('jdPdf', newJdFile); // Key must match upload.single('jdPdf') in backend
            body = formData;
            // Don't set Content-Type header for FormData, browser does it with boundary
        } else {
            // --- Handle URL Submission ---
            endpoint = `${API_BASE_URL}/roles/${selectedRoleId}/jds/url`;
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify({ url: newJdUrl.trim() });
        }

        response = await fetch(endpoint, { method: 'POST', headers, body });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to add JD URL: ${response.statusText}`);
      }
      const createdJd = await response.json();
      setJds([...jds, createdJd]); // Add new JD to the list
      setNewJdUrl(''); // Clear input
      setNewJdFile(null); // Clear file state
      if (fileInputRef.current) fileInputRef.current.value = ''; // Clear file input visually
    } catch (err) {
      console.error("Error adding JD:", err);
      setError(err.message || 'Failed to add JD.');
    } finally {
      setAddLoading(false);
    }
  };

  // Handle triggering analysis for a JD
  const handleAnalyzeJd = async (jdId) => {
    setAnalyzeLoading(prev => ({ ...prev, [jdId]: true })); // Set loading for this specific JD
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/jds/${jdId}/analyze`, {
        method: 'POST',
      });
       const responseData = await response.json(); // Read body even for 202
      if (!response.ok) {
         // Use error message from response body if available
        throw new Error(responseData.error || `Failed to start analysis: ${response.statusText}`);
      }
      // Update the local JD state to 'processing' immediately based on 202 response
      setJds(prevJds => prevJds.map(jd =>
        jd.id === jdId ? { ...jd, status: 'processing', error: null } : jd
      ));
      // Optionally: Implement polling or WebSocket to get final status,
      // or just require manual refresh via fetchJds.
      // For simplicity, we'll rely on manual refresh for now.
       alert(responseData.message || 'Analysis started. Refresh list later to see results.'); // Simple feedback

    } catch (err) {
      console.error(`Error triggering analysis for JD ${jdId}:`, err);
      setError(`Analysis trigger failed for JD ${jdId}: ${err.message}`);
       // Optionally update local JD state to 'failed' on trigger error
       setJds(prevJds => prevJds.map(jd =>
        jd.id === jdId ? { ...jd, status: 'failed', error: `Trigger failed: ${err.message}` } : jd
      ));
    } finally {
      setAnalyzeLoading(prev => ({ ...prev, [jdId]: false })); // Clear loading for this specific JD
    }
  };

  // Handle deleting a JD
  const handleDeleteJd = async (jdId) => {
    if (!window.confirm('Are you sure you want to delete this Job Description? This cannot be undone.')) {
      return;
    }
    setDeleteLoading(prev => ({ ...prev, [jdId]: true }));
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/jds/${jdId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        // Try to get error message from response body
        let errorMsg = `Failed to delete JD: ${response.statusText}`;
        try {
            const errorData = await response.json();
            errorMsg = errorData.error || errorMsg;
        } catch (jsonError) {
            // Ignore if response body is not JSON
        }
        throw new Error(errorMsg);
      }
      // If deletion is successful (status 204 No Content or 200 OK)
      setJds(prevJds => prevJds.filter(jd => jd.id !== jdId));
      console.log(`Successfully deleted JD ${jdId}`);
    } catch (err) {
      console.error(`Error deleting JD ${jdId}:`, err);
      setError(`Failed to delete JD ${jdId}: ${err.message}`);
      // Optionally: Add specific error state to the JD item if needed
    } finally {
      setDeleteLoading(prev => ({ ...prev, [jdId]: false }));
    }
  };

  return (
    <div className="jd-manager section-container">
      <h3>Job Descriptions for Selected Role</h3>

      {/* Add JD Form (URL or Upload) */}
      <form onSubmit={handleAddJd} className="add-jd-form">
         <div className="jd-input-group">
             <label htmlFor="jdUrlInput">Enter URL:</label>
             <input
                id="jdUrlInput"
                type="url"
                value={newJdUrl}
                onChange={handleUrlChange}
                placeholder="https://..."
                disabled={addLoading || isLoading || !!newJdFile} // Disable if file selected
             />
         </div>
          <span>OR</span>
         <div className="jd-input-group">
            <label htmlFor="jdFileInput">Upload PDF:</label>
             <input
                id="jdFileInput"
                type="file"
                accept=".pdf" // Only allow PDF
                onChange={handleFileChange}
                ref={fileInputRef}
                disabled={addLoading || isLoading || !!newJdUrl.trim()} // Disable if URL entered
             />
         </div>
        <button type="submit" disabled={addLoading || isLoading || (!newJdUrl.trim() && !newJdFile)}>
          {addLoading ? 'Adding...' : 'Add JD'}
        </button>
         <button type="button" onClick={fetchJds} disabled={isLoading} title="Refresh JD List">
            🔄 Refresh
         </button>
      </form>

      {/* Display Errors */}
      {error && <p className="error-message">{error}</p>}

      {/* List JDs */}
      <h4>Added Job Descriptions:</h4>
      {isLoading && <p>Loading JDs...</p>}
      {!isLoading && jds.length === 0 && !error && <p>No JDs added for this role yet.</p>}
      {jds.length > 0 && (
        <ul className="jd-list">
          {jds.map((jd) => (
            <li key={jd.id} className={`jd-item status-${jd.status}`}>
              <div className="jd-source"> {/* Renamed class */}
                 {jd.type === 'url' ? (
                     <a href={jd.source} target="_blank" rel="noopener noreferrer" title={jd.source}>
                        {jd.source.length > 80 ? jd.source.substring(0, 80) + '...' : jd.source}
                     </a>
                 ) : (
                     <span title={jd.source}> {/* Show UUID filename on hover */}
                        PDF: {jd.originalFilename || jd.source} {/* Display original name */}
                     </span>
                 )}
              </div>
              <div className="jd-status">Status: <strong>{jd.status}</strong></div>
              <div className="jd-actions">
                {(jd.status === 'pending' || jd.status === 'failed') && (
                  <button
                    onClick={() => handleAnalyzeJd(jd.id)}
                    disabled={analyzeLoading[jd.id] || isLoading}
                    title={jd.status === 'failed' ? `Retry analysis (Error: ${jd.error})` : 'Analyze this JD'}
                  >
                    {analyzeLoading[jd.id] ? 'Starting...' : (jd.status === 'failed' ? 'Retry Analysis' : 'Analyze')}
                  </button>
                )}
                 {jd.status === 'processing' && (
                    <span>(Processing...)</span>
                 )}
                 {/* Delete Button */}
                 <button
                    onClick={() => handleDeleteJd(jd.id)}
                    disabled={deleteLoading[jd.id] || isLoading || addLoading || analyzeLoading[jd.id]}
                    className="delete-button"
                    title="Delete this JD"
                 >
                    {deleteLoading[jd.id] ? 'Deleting...' : '🗑️ Delete'}
                 </button>
                 {/* Add button/link to view details later */}
              </div>
               {jd.status === 'failed' && jd.error && (
                 <div className="jd-error error-message">Error: {jd.error}</div>
               )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default JdManager;
