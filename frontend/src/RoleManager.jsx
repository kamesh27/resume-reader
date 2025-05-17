import React, { useState, useEffect } from 'react';

// Define API URL (adjust if needed)
const ROLES_API_URL = 'http://localhost:3001/api/roles';

function RoleManager({ onRoleSelect, selectedRoleId }) { // Accept props for selection handling
  const [roles, setRoles] = useState([]);
  const [newRoleName, setNewRoleName] = useState('');
  const [isLoading, setIsLoading] = useState(false); // General loading (fetch, create)
  const [deleteLoading, setDeleteLoading] = useState({}); // State for role deletion loading
  const [error, setError] = useState(null);

  // Fetch existing roles on component mount
  useEffect(() => {
    fetchRoles();
  }, []);

  const fetchRoles = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(ROLES_API_URL);
      if (!response.ok) {
        throw new Error(`Failed to fetch roles: ${response.statusText}`);
      }
      const data = await response.json();
      setRoles(data || []); // Ensure roles is always an array
    } catch (err) {
      console.error("Error fetching roles:", err);
      setError(err.message || 'Failed to load roles.');
      setRoles([]); // Clear roles on error
    } finally {
      setIsLoading(false);
    }
  };

  // Handle deleting a role
  const handleDeleteRole = async (roleIdToDelete, roleName) => {
    if (!window.confirm(`Are you sure you want to delete the role "${roleName}"? This will also delete all associated Job Descriptions and cannot be undone.`)) {
      return;
    }
    setDeleteLoading(prev => ({ ...prev, [roleIdToDelete]: true }));
    setError(null);
    try {
      const response = await fetch(`${ROLES_API_URL}/${roleIdToDelete}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        let errorMsg = `Failed to delete role: ${response.statusText}`;
        try {
            const errorData = await response.json();
            errorMsg = errorData.error || errorMsg;
        } catch (jsonError) { /* Ignore */ }
        throw new Error(errorMsg);
      }
      // Success (204 No Content or 200 OK)
      setRoles(prevRoles => prevRoles.filter(role => role.id !== roleIdToDelete));
      console.log(`Successfully deleted role ${roleIdToDelete}`);
      // If the deleted role was the selected one, clear the selection in the parent
      if (selectedRoleId === roleIdToDelete) {
        onRoleSelect(null);
      }
    } catch (err) {
      console.error(`Error deleting role ${roleIdToDelete}:`, err);
      setError(`Failed to delete role "${roleName}": ${err.message}`);
    } finally {
      setDeleteLoading(prev => ({ ...prev, [roleIdToDelete]: false }));
    }
  };

  // Handle creating a new role
  const handleCreateRole = async (event) => {
    event.preventDefault(); // Prevent default form submission
    if (!newRoleName.trim()) {
      setError('Please enter a role name.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(ROLES_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRoleName.trim() }),
      });
      if (!response.ok) {
         const errorData = await response.json();
        throw new Error(errorData.error || `Failed to create role: ${response.statusText}`);
      }
      const createdRole = await response.json();
      setRoles([...roles, createdRole]); // Add new role to the list
      setNewRoleName(''); // Clear input field
      // Optionally auto-select the newly created role
      // onRoleSelect(createdRole.id);
    } catch (err) {
      console.error("Error creating role:", err);
      setError(err.message || 'Failed to create role.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="role-manager section-container"> {/* Add class for styling */}
      <h3>Manage Roles</h3>

      {/* Create Role Form */}
      <form onSubmit={handleCreateRole} className="create-role-form">
        <input
          type="text"
          value={newRoleName}
          onChange={(e) => setNewRoleName(e.target.value)}
          placeholder="Enter new role name (e.g., Product Manager)"
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !newRoleName.trim()}>
          {isLoading ? 'Creating...' : 'Create Role'}
        </button>
      </form>

      {/* Display Errors */}
      {error && <p className="error-message">{error}</p>}

      {/* List Existing Roles */}
      <h4>Existing Roles:</h4>
      {isLoading && roles.length === 0 && <p>Loading roles...</p>}
      {!isLoading && roles.length === 0 && !error && <p>No roles created yet.</p>}
      {roles.length > 0 && (
        <ul className="role-list">
          {roles.map((role) => (
            <li
              key={role.id}
              className={role.id === selectedRoleId ? 'selected' : ''} // Highlight selected
              onClick={() => !isLoading && !deleteLoading[role.id] && onRoleSelect(role.id)} // Allow selection only if not deleting
            >
              <span className="role-name">{role.name}</span>
              <span className="role-info"> (JDs: {role.jdIds?.length || 0})</span>
              <button
                onClick={(e) => {
                  e.stopPropagation(); // Prevent li onClick from firing
                  handleDeleteRole(role.id, role.name);
                }}
                disabled={isLoading || deleteLoading[role.id]}
                className="delete-button role-delete-button" // Add specific class
                title={`Delete role "${role.name}"`}
              >
                {deleteLoading[role.id] ? 'Deleting...' : '🗑️'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default RoleManager;
