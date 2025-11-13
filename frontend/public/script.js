// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {

  const loginForm = document.getElementById('loginForm');
  const registerButton = document.getElementById('registerButton');
  const messageEl = document.getElementById('message');

  const API_URL = 'http://localhost:3000'; // Our backend API

  // --- Handle Login ---
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault(); // Prevent default form submission
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
      const res = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.ok) {
        showMessage(`Login successful! Token: ${data.token.substring(0, 20)}...`, 'success');
        // You'd save this token (e.g., in localStorage) instead of displaying
      } else {
        showMessage(`Error: ${data.message}`, 'danger');
      }
    } catch (err) {
      showMessage(`Error: ${err.message}`, 'danger');
    }
  });

  // --- Handle Registration ---
  registerButton.addEventListener('click', async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    if (!email || !password) {
      showMessage('Please enter email and password to register', 'warning');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.status === 201) {
        showMessage('Registration successful! You can now log in.', 'success');
      } else {
        showMessage(`Error: ${data.message}`, 'danger');
      }
    } catch (err) {
      showMessage(`Error: ${err.message}`, 'danger');
    }
  });


  // Helper function to show messages
  function showMessage(message, type) {
    messageEl.textContent = message;
    messageEl.className = `card-footer alert alert-${type}`;
    messageEl.style.display = 'block';
  }
});