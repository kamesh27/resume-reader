import React from 'react'; // Removed useState, useEffect

// Accept props passed down from App.jsx
function ResumeCustomizer({
    roles,
    selectedRole,
    selectedFile,
    isLoading,
    results, // Holds initial context like { analysisContext, contextName }
    streamingResults, // Holds the array of { original, suggestions, isRelevant, error } as they arrive
    progress, // Holds { current, total, message }
    error,
    selectionType,
    availableJds,
    selectedJd,
    jdAnalysisSummary,
    onFileChange,
    onRoleChange,
    onJdChange,
    onSelectionTypeChange,
    onSubmit,
    // Updated props from App.jsx
    allOptionTexts, // Contains the current text for all options
    selectedOptionInfo, // Contains the info about which option is selected
    onPointSelectionChange, // Handler to update selectedOptionInfo
    onGeneratePdf,
    currentJobId,
    // Props for inline editing
    editingPointKey,
    tempEditValue, // New prop for temporary edit value
    onSetEditingPoint,
    onPointEditChange,
    onSavePointEdit // New prop for saving edit
}) {

    // All state and handlers are now managed by App.jsx and passed as props.

    return (
        <div className="resume-customizer-container" style={styles.container}>
            <h2>Resume Customizer</h2>
            {/* Use the onSubmit handler passed from App */}
            <form onSubmit={onSubmit} style={styles.form}>
                 {/* Selection Type Radio Buttons */}
                 <div style={styles.formGroup}>
                    <label style={styles.label}>Analyze Against:</label>
                    <div style={styles.radioGroup}>
                        <label style={styles.radioLabel}>
                            <input
                                type="radio"
                                value="role"
                                checked={selectionType === 'role'}
                                onChange={onSelectionTypeChange} // Use prop handler
                                disabled={isLoading}
                            />
                            Predefined Role
                        </label>
                        <label style={styles.radioLabel}>
                            <input
                                type="radio"
                                value="jd"
                                checked={selectionType === 'jd'}
                                onChange={onSelectionTypeChange} // Use prop handler
                                disabled={isLoading || availableJds.length === 0}
                            />
                            Specific Job Description
                        </label>
                    </div>
                 </div>

                 {/* Conditional Dropdown: Role */}
                 {selectionType === 'role' && (
                    <div style={styles.formGroup}>
                        <label htmlFor="roleSelect" style={styles.label}>Target Role:</label>
                        <select
                            id="roleSelect"
                            value={selectedRole} // Use prop value
                            onChange={onRoleChange} // Use prop handler
                            disabled={roles.length === 0 || isLoading} // Use prop value
                            style={styles.select}
                        >
                            {/* Use roles prop */}
                            {roles.length === 0 && !isLoading ? (
                                <option>No roles defined</option>
                            ) : isLoading && roles.length === 0 ? ( // Use isLoading prop
                                <option>Loading roles...</option>
                            ) : (
                                roles.map((role) => ( // Use roles prop
                                    <option key={role.id} value={role.id}>
                                        {role.name}
                                    </option>
                                ))
                            )}
                        </select>
                    </div>
                 )}

                 {/* Conditional Dropdown: JD */}
                 {selectionType === 'jd' && (
                     <div style={styles.formGroup}>
                        <label htmlFor="jdSelect" style={styles.label}>Specific Job Description:</label>
                        <select
                            id="jdSelect"
                            value={selectedJd} // Use prop value
                            onChange={onJdChange} // Use prop handler
                            disabled={availableJds.length === 0 || isLoading} // Use prop values
                            style={styles.select}
                        >
                            {/* Use availableJds prop */}
                            {availableJds.length === 0 && !isLoading ? ( // Use isLoading prop
                                <option>No analyzed JDs available</option>
                             ) : isLoading && availableJds.length === 0 ? ( // Use isLoading prop
                                <option>Loading JDs...</option>
                             ) : (
                                availableJds.map((jd) => ( // Use availableJds prop
                                    <option key={jd.id} value={jd.id}>
                                        {jd.originalFilename || jd.source} ({jd.roleName})
                                    </option>
                                ))
                             )}
                        </select>
                     </div>
                 )}


                <div style={styles.formGroup}>
                    <label htmlFor="resumeFile" style={styles.label}>Upload Resume (PDF):</label>
                    <input
                        type="file"
                        id="resumeFile"
                        accept=".pdf"
                        onChange={onFileChange} // Use prop handler
                        disabled={isLoading} // Use prop value
                        style={styles.input}
                        // Note: File input value is not controlled by React state directly
                    />
                </div>

                {/* Update disabled logic for submit button */}
                <button
                    type="submit"
                    disabled={ // Use prop values for disabled logic
                        isLoading ||
                        !selectedFile || // Check the prop passed from App
                        (selectionType === 'role' && !selectedRole) ||
                        (selectionType === 'jd' && !selectedJd)
                    }
                    style={styles.button}
                >
                    {isLoading ? 'Analyzing...' : 'Customize Resume'} {/* Use isLoading prop */}
                </button>
            </form>

            {/* Use error prop */}
            {error && <p style={styles.error}>Error: {error}</p>}

             {/* Display Loading and Progress */}
             {isLoading && (
                <div style={styles.progressContainer}>
                    <p>Processing... {progress ? `(${progress.message})` : ''}</p>
                    {/* Optional: Add a visual progress bar if desired */}
                    {progress && progress.total > 0 && (
                         <progress value={progress.current} max={progress.total} style={{ width: '100%' }} />
                    )}
                </div>
            )}

            {/* Display JD Analysis Summary if available (use prop) - Keep this */}
            {jdAnalysisSummary && !isLoading && ( // Only show summary when not loading results
                 <div style={{...styles.resultsContainer, borderTop: '2px solid #007bff', marginTop: '30px'}}>
                    <h3>Job Description Summary ({results?.contextName})</h3>
                    <pre style={styles.jdSummary}>{jdAnalysisSummary}</pre>
                 </div>
            )}

            {/* Display Streaming Point-by-Point Results */}
            {(streamingResults.length > 0 || (!isLoading && results && streamingResults.length === 0)) && ( // Show container if results streamed or processing finished (even if 0 points)
                <div style={styles.resultsContainer}>
                     {/* Use context from initial results object */}
                    <h3>Processed Resume Points {results?.contextName ? `(vs. ${results.analysisContext === 'jd' ? 'JD' : 'Role'}: ${results.contextName})` : ''}</h3>
                    {streamingResults.length === 0 && !isLoading ? (
                        <p>No results yet, or processing finished with no points found/processed.</p> // Message if finished but no points
                    ) : (
                        // Iterate over the streamingResults array
                        streamingResults.map((item, index) => (
                            <div key={index} style={styles.pointBlock}>
                                <p style={styles.originalPoint}>
                                    <strong>Original:</strong> {item.original}
                                    <span style={item.isRelevant ? styles.relevantTag : styles.irrelevantTag}>
                                        {item.isRelevant ? ' (Relevant)' : ' (General)'}
                                    </span>
                                </p>
                                {/* Radio Button Selection Area with Inline Editing */}
                                <div style={styles.selectionGroup}>
                                    {/* Option 1: Keep Original */}
                                    {(() => {
                                        const currentKey = `${item.original}::original`; // Unique key for editing state
                                        const isEditing = editingPointKey === currentKey;
                                        // Get current text from allOptionTexts, fallback to original item text if needed
                                        const currentOptionText = allOptionTexts[item.original]?.original ?? item.original;
                                        const choiceInfo = selectedOptionInfo[item.original];
                                        const isChecked = choiceInfo?.type === 'original'; // Check based on selection info

                                        return (
                                            <div style={styles.selectionOptionContainer}>
                                                <input
                                                    type="radio"
                                                    name={`selection-${index}`}
                                                    value={currentOptionText} // Value could be the current text
                                                    checked={isChecked}
                                                    // Pass only type to selection handler
                                                    onChange={() => onPointSelectionChange(item.original, 'original')}
                                                    disabled={isLoading}
                                                    style={styles.radioInput}
                                                />
                                                {isEditing ? (
                                                    <div style={styles.editContainer}>
                                                        <textarea
                                                            value={tempEditValue} // Use temp value
                                                            onChange={(e) => onPointEditChange(e.target.value)} // Update temp value
                                                            style={styles.inlineTextarea}
                                                            autoFocus
                                                            rows={3}
                                                        />
                                                        <div style={styles.editActions}>
                                                            <button
                                                                type="button"
                                                                // Pass type to save handler
                                                                onClick={() => onSavePointEdit(item.original, 'original')}
                                                                style={{...styles.editActionButton, ...styles.saveButton}}
                                                            >
                                                                Save
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => onSetEditingPoint(null)} // Cancel action
                                                                style={{...styles.editActionButton, ...styles.cancelButton}}
                                                            >
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    /* Display text directly from allOptionTexts */
                                                    <span style={styles.selectionText}>
                                                        {currentOptionText}
                                                    </span>
                                                )}
                                                {!isEditing && (
                                                    <button
                                                        type="button"
                                                        // Pass type to edit handler
                                                        onClick={() => onSetEditingPoint(currentKey, item.original, 'original')}
                                                        disabled={isLoading}
                                                        style={styles.editButton}
                                                        title="Edit this option"
                                                    >
                                                        Edit
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    {/* Option 2+: Suggestions (if no error) */}
                                    {!item.error && allOptionTexts[item.original]?.suggestions && allOptionTexts[item.original].suggestions.map((currentSuggestionText, sIndex) => {
                                        const currentKey = `${item.original}::suggestion::${sIndex}`; // Unique key for editing state
                                        const isEditing = editingPointKey === currentKey;
                                        const choiceInfo = selectedOptionInfo[item.original];
                                        // Check based on selection info (type and index)
                                        const isChecked = choiceInfo?.type === 'suggestion' && choiceInfo?.index === sIndex;

                                        return (
                                            <div key={sIndex} style={styles.selectionOptionContainer}>
                                                <input
                                                    type="radio"
                                                    name={`selection-${index}`}
                                                    value={currentSuggestionText} // Value could be the current text
                                                    checked={isChecked}
                                                    // Pass type and index to selection handler
                                                    onChange={() => onPointSelectionChange(item.original, 'suggestion', sIndex)}
                                                    disabled={isLoading}
                                                    style={styles.radioInput}
                                                />
                                                {isEditing ? (
                                                    <div style={styles.editContainer}>
                                                        <textarea
                                                            value={tempEditValue} // Use temp value
                                                            onChange={(e) => onPointEditChange(e.target.value)} // Update temp value
                                                            style={styles.inlineTextarea}
                                                            autoFocus
                                                            rows={3}
                                                        />
                                                        <div style={styles.editActions}>
                                                            <button
                                                                type="button"
                                                                // Pass type and index to save handler
                                                                onClick={() => onSavePointEdit(item.original, 'suggestion', sIndex)}
                                                                style={{...styles.editActionButton, ...styles.saveButton}}
                                                            >
                                                                Save
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => onSetEditingPoint(null)} // Cancel action
                                                                style={{...styles.editActionButton, ...styles.cancelButton}}
                                                            >
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    /* Display text directly from allOptionTexts */
                                                    <span style={styles.selectionText}>
                                                        {currentSuggestionText}
                                                    </span>
                                                )}
                                                 {!isEditing && (
                                                    <button
                                                        type="button"
                                                        // Pass type and index to edit handler
                                                        onClick={() => onSetEditingPoint(currentKey, item.original, 'suggestion', sIndex)}
                                                        disabled={isLoading}
                                                        style={styles.editButton}
                                                        title="Edit this option"
                                                    >
                                                        Edit
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}

                                    {/* Display point-specific error if any */}
                                    {item.error && (
                                        <p style={{...styles.noSuggestions, color: 'red', marginLeft: '0'}}>
                                            Error: {item.error} (Original point will be kept)
                                        </p>
                                    )}
                                     {/* Message if no suggestions and no error */}
                                     {!item.error && (!allOptionTexts[item.original]?.suggestions || allOptionTexts[item.original].suggestions.length === 0) && (
                                        <p style={{...styles.noSuggestions, marginLeft: '0'}}>
                                            No suggestions generated. (Original point will be kept)
                                        </p>
                                     )}
                                </div>
                            </div>
                        ))
                    )}
                     {/* Add Generate PDF Button */}
                     {streamingResults.length > 0 && !isLoading && currentJobId && (
                         <button
                             onClick={onGeneratePdf}
                             disabled={isLoading} // Disable if already loading (e.g., generating PDF)
                             style={{...styles.button, marginTop: '20px', backgroundColor: '#28a745'}} // Green button
                         >
                             {isLoading ? 'Generating...' : 'Generate Edited PDF'}
                         </button>
                     )}
                </div>
            )}
        </div>
    );
}

// Basic inline styles (consider moving to CSS file for larger apps)
const styles = {
    container: {
        padding: '20px',
        border: '1px solid #ccc',
        borderRadius: '8px',
        maxWidth: '700px',
        margin: '20px auto',
        fontFamily: 'Arial, sans-serif',
    },
    form: {
        display: 'flex',
        flexDirection: 'column',
        gap: '15px',
        marginBottom: '20px',
    },
     radioGroup: {
        display: 'flex',
        gap: '15px',
        marginTop: '5px',
    },
    radioLabel: {
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        cursor: 'pointer',
    },
    formGroup: {
        display: 'flex',
        flexDirection: 'column',
    },
    label: {
        marginBottom: '5px',
        fontWeight: 'bold',
    },
    select: {
        padding: '8px',
        border: '1px solid #ccc',
        borderRadius: '4px',
    },
    input: {
        padding: '8px',
    },
    button: {
        padding: '10px 15px',
        backgroundColor: '#007bff',
        color: 'white',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer',
        fontSize: '1em',
    },
    buttonDisabled: {
        backgroundColor: '#ccc',
        cursor: 'not-allowed',
    },
    error: {
        color: 'red',
        marginTop: '10px',
    },
    resultsContainer: {
        marginTop: '20px',
        borderTop: '1px solid #eee',
        paddingTop: '20px',
    },
    resultItem: { // Kept for potential future use, but not used in current streaming display
        marginBottom: '15px',
    },
    explanation: { // Kept for potential future use
        fontSize: '0.9em',
        color: '#555',
        marginTop: '5px',
        fontStyle: 'italic',
    },
    list: {
        listStyleType: 'disc',
        marginLeft: '20px',
        paddingLeft: '0', // Reset default ul padding
    },
    listItem: {
         marginBottom: '10px', // Increased spacing
         lineHeight: '1.4',
         display: 'flex', // Use flexbox for layout
         justifyContent: 'space-between', // Space out text and button
         alignItems: 'flex-start', // Align items to the top
         gap: '10px', // Gap between text and button
    },
    copyButton: { // Style for the copy button
        padding: '3px 8px',
        fontSize: '0.8em',
        cursor: 'pointer',
        backgroundColor: '#e9ecef',
        border: '1px solid #ced4da',
        borderRadius: '3px',
        whiteSpace: 'nowrap', // Prevent button text wrapping
        marginLeft: 'auto', // Push button to the right if needed (though justify-content should handle it)
    },
    pointBlock: { // Style for each original point + suggestions block
        borderBottom: '1px solid #eee',
        paddingBottom: '15px',
        marginBottom: '15px',
    },
    originalPoint: {
        fontWeight: 'bold',
        marginBottom: '10px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    relevantTag: {
        fontSize: '0.8em',
        fontWeight: 'normal',
        color: 'green',
        marginLeft: '10px',
    },
    irrelevantTag: {
        fontSize: '0.8em',
        fontWeight: 'normal',
        color: '#6c757d', // Grey color
        marginLeft: '10px',
    },
    noSuggestions: {
        fontStyle: 'italic',
        color: '#6c757d',
        marginLeft: '20px',
    },
    progressContainer: { // Style for loading/progress indicator
        marginTop: '20px',
        padding: '10px',
        backgroundColor: '#f8f9fa',
        border: '1px solid #e9ecef',
        borderRadius: '4px',
        textAlign: 'center',
    },
    jdSummary: {
        whiteSpace: 'pre-wrap',
        wordWrap: 'break-word',
        backgroundColor: '#f8f9fa',
        padding: '10px',
        border: '1px solid #e9ecef',
        borderRadius: '4px',
        fontSize: '0.9em',
        maxHeight: '300px', // Limit height and make scrollable if needed
        overflowY: 'auto',
    },
    // Styles for Radio Button Selections
    selectionGroup: {
        marginLeft: '20px',
        marginTop: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
    },
    selectionLabel: {
        display: 'flex',
        alignItems: 'flex-start', // Align radio button with start of text
        gap: '8px',
        // Removed cursor: pointer as the whole label isn't clickable now
        fontSize: '0.95em',
        lineHeight: '1.4',
        // Removed display: flex and align-items as we use a container div now
    },
    // New styles for inline editing
    selectionOptionContainer: { // Container for radio + text/textarea + button
        display: 'flex',
        alignItems: 'flex-start', // Align radio with top of text/textarea
        gap: '8px',
        width: '100%', // Ensure container takes full width
        marginBottom: '5px', // Add some space between options
    },
    radioInput: {
        marginTop: '4px', // Adjust vertical alignment of radio button if needed
    },
    selectionText: {
        flexGrow: 1, // Allow text to take available space
        wordBreak: 'break-word', // Prevent long text overflow
        paddingTop: '2px', // Align text slightly better with radio
    },
    editButton: {
        padding: '2px 6px',
        fontSize: '0.8em',
        cursor: 'pointer',
        backgroundColor: '#f0f0f0',
        border: '1px solid #ccc',
        borderRadius: '3px',
        marginLeft: 'auto', // Push button to the right
        whiteSpace: 'nowrap',
    },
    inlineTextarea: {
        flexGrow: 1, // Take available space
        padding: '5px',
        border: '1px solid #007bff', // Highlight when editing
        borderRadius: '4px',
        fontSize: '0.95em', // Match label font size
        fontFamily: 'inherit', // Use the same font
        lineHeight: '1.4',
        resize: 'vertical', // Allow vertical resize
        minHeight: '40px',
    },
    editContainer: { // Container for textarea + action buttons
        flexGrow: 1,
        display: 'flex',
        flexDirection: 'column',
    },
    editActions: { // Container for Save/Cancel buttons
        display: 'flex',
        gap: '5px',
        marginTop: '5px',
        alignSelf: 'flex-end', // Align buttons to the right below textarea
    },
    editActionButton: {
        padding: '3px 8px',
        fontSize: '0.8em',
        cursor: 'pointer',
        border: '1px solid',
        borderRadius: '3px',
        whiteSpace: 'nowrap',
    },
    saveButton: {
        backgroundColor: '#d4edda', // Light green
        borderColor: '#c3e6cb',
        color: '#155724',
    },
    cancelButton: {
        backgroundColor: '#f8d7da', // Light red
        borderColor: '#f5c6cb',
        color: '#721c24',
    },
};

// Add disabled styles dynamically if needed
styles.button = {
    ...styles.button,
    ':disabled': styles.buttonDisabled // Example for pseudo-class (might need library like styled-components for full support)
};


export default ResumeCustomizer;
