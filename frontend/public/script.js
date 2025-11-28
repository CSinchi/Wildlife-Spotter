// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {

  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const messageEl = document.getElementById('message');

  const API_URL = 'http://localhost:3000'; // Our backend API

  // --- Handle Login ---
  if (loginForm) {
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
  })};

  // --- Handle Registration ---
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      // Get all 4 values from the registration form
      const username = document.getElementById('username').value;
      const phone = document.getElementById('phone').value;
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;

      try {
        const res = await fetch(`${API_URL}/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Send the new fields to the backend
          body: JSON.stringify({
            username: username,
            phone_number: phone, // Make sure backend expects 'phone_number'
            email: email,
            password: password
          }),
        });

        const data = await res.json();

        if (res.status === 201) {
          showMessage('Registration successful! Redirecting to login...', 'success');
          // Redirect to login page after a short delay
          setTimeout(() => {
              window.location.href = 'login.html';
          }, 2000);
        } else {
          showMessage(`Error: ${data.message}`, 'danger');
        }
      } catch (err) {
        showMessage(`Error: ${err.message}`, 'danger');
      }
    });
  }

  // Helper function to show messages
  function showMessage(message, type) {
    if (messageEl) {
      messageEl.textContent = message;
      messageEl.className = `card-footer alert alert-${type}`;
      messageEl.style.display = 'block';
    } else {
      console.log('Message element not found, but that might be ok.');
    }
  }
});