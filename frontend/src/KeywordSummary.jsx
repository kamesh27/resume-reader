import React, { useState, useEffect, useCallback } from 'react';

// Define API URL (adjust if needed)
const API_BASE_URL = 'http://localhost:3001/api';

function KeywordSummary({ selectedRoleId }) {
  const [summaryData, setSummaryData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchKeywordSummary = useCallback(async () => {
    if (!selectedRoleId) {
      setSummaryData(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/roles/${selectedRoleId}/keywords`);
      if (!response.ok) {
        throw new Error(`Failed to fetch keyword summary: ${response.statusText}`);
      }
      const data = await response.json();
      setSummaryData(data);
    } catch (err) {
      console.error(`Error fetching keyword summary for role ${selectedRoleId}:`, err);
      setError(err.message || 'Failed to load keyword summary.');
      setSummaryData(null);
    } finally {
      setIsLoading(false);
    }
  }, [selectedRoleId]);

  useEffect(() => {
    fetchKeywordSummary();
  }, [fetchKeywordSummary]);

  return (
    <div className="keyword-summary section-container">
      <h3>Keyword Summary for Selected Role</h3>
       <button onClick={fetchKeywordSummary} disabled={isLoading || !selectedRoleId} title="Refresh Summary">
         🔄 Refresh Summary
       </button>

      {isLoading && <p>Loading keyword summary...</p>}
      {error && <p className="error-message">{error}</p>}

      {summaryData && !isLoading && !error && (
        <>
          <p>
            Summary based on <strong>{summaryData.completedJdCount || 0}</strong> successfully analyzed job descriptions
            for role: <strong>{summaryData.roleName}</strong>.
          </p>
          {summaryData.keywordsSummary && summaryData.keywordsSummary.length > 0 ? (
            <ul className="keyword-list">
              {summaryData.keywordsSummary.map(({ keyword, count }) => (
                <li key={keyword}>
                  <span className="keyword-text">{keyword}</span>
                  <span className="keyword-count">({count})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No keywords found or no JDs analyzed yet for this role.</p>
          )}
        </>
      )}
       {!summaryData && !isLoading && !error && selectedRoleId && (
         <p>Select a role and analyze JDs to see the keyword summary.</p>
       )}
    </div>
  );
}

export default KeywordSummary;
