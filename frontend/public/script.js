// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('Script loaded.');

  const API_URL = 'http://localhost:3000'; // Our backend API

  // Elements
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const messageEl = document.getElementById('message');
  const navLinks = document.getElementById('navLinks');

  // --- Auth & Navigation State ---
  const token = localStorage.getItem('token');
  const currentPath = window.location.pathname;
  const username = localStorage.getItem('username');

  function updateNavbar() {
    if (navLinks) {
        navLinks.innerHTML = '';
        const homeLi = '<li class="nav-item"><a class="nav-link" href="index.html">Home</a></li>';

        if (token) {
            // Logged In
            navLinks.innerHTML = `
                ${homeLi}
                <li class="nav-item"><a class="nav-link" href="new-sighting.html">New Sighting</a></li>
                <li class="nav-item"><a class="nav-link" href="dashboard.html">${username || 'Dashboard'}</a></li>
                <li class="nav-item"><a class="nav-link" href="#" id="logoutBtn">Logout</a></li>
            `;

            // Attach logout handler
            document.getElementById('logoutBtn').addEventListener('click', async (e) => {
                e.preventDefault();
                localStorage.removeItem('token');
                localStorage.removeItem('username');
                try { await fetch(`${API_URL}/logout`, { method: 'POST' }); } catch(e) {}
                window.location.href = 'login.html';
            });

        } else {
            // Logged Out
            navLinks.innerHTML = `
                ${homeLi}
                <li class="nav-item"><a class="nav-link" href="login.html">Login</a></li>
                <li class="nav-item"><a class="nav-link" href="register.html">Register</a></li>
            `;

            // Redirect from protected pages
            if (currentPath.includes('dashboard.html') || currentPath.includes('new-sighting.html')) {
               window.location.href = 'login.html';
            }
        }
    }
  }

  updateNavbar();


  // --- Helper: Show Messages ---
  function showMessage(message, type) {
    if (messageEl) {
      messageEl.textContent = message;
      messageEl.className = `alert alert-${type}`;
      messageEl.style.display = 'block';
      // Auto hide after 5 seconds
      setTimeout(() => { messageEl.style.display = 'none'; }, 5000);
    } else {
      console.log('Message element not found:', message);
      alert(message);
    }
  }

  // --- Handle Login ---
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;

      try {
        const res = await fetch(`${API_URL}/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (res.ok) {
          localStorage.setItem('token', data.token);
          localStorage.setItem('username', data.username);
          showMessage('Login successful!', 'success');
          setTimeout(() => { window.location.href = 'index.html'; }, 1000);
        } else {
          showMessage(`Error: ${data.message}`, 'danger');
        }
      } catch (err) {
        showMessage(`Error: ${err.message}`, 'danger');
      }
    });
  }

  // --- Handle Registration ---
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value;
      const phone = document.getElementById('phone').value;
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;

      try {
        const res = await fetch(`${API_URL}/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, phone_number: phone, email, password }),
        });
        const data = await res.json();
        if (res.status === 201) {
          showMessage('Registration successful! Redirecting...', 'success');
          setTimeout(() => { window.location.href = 'login.html'; }, 2000);
        } else {
          showMessage(`Error: ${data.message}`, 'danger');
        }
      } catch (err) {
        showMessage(`Error: ${err.message}`, 'danger');
      }
    });
  }

  // --- Page: Home (Map) ---
  if (document.getElementById('map') && !document.getElementById('mapPicker')) {
      const map = L.map('map').setView([0, 0], 2);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap'
      }).addTo(map);

      // Locate user
      map.locate({setView: true, maxZoom: 10});

      map.on('locationfound', (e) => {
          // Load sightings around user? Or just all for now
          // For now, let's load all and filter by viewport if needed, or just all.
          // The requirements say "retrieves all sightings within a specific geographical area".
          // We can fetch all for now or implement bounding box logic.
          // Simpler to just fetch all recently added for the demo.
      });

      map.on('locationerror', () => {
          console.log("Location access denied.");
      });

      // Search Logic
      const searchInput = document.getElementById('searchInput');
      const searchBtn = document.getElementById('searchBtn');
      const searchType = document.getElementById('searchType');
      const searchSuggestions = document.getElementById('searchSuggestions');
      let allSightings = [];
      let markersLayer = L.layerGroup().addTo(map);

      // Helper: Debounce
      function debounce(func, wait) {
          let timeout;
          return function(...args) {
              clearTimeout(timeout);
              timeout = setTimeout(() => func.apply(this, args), wait);
          };
      }

      // Helper: Show Suggestions
      function showSuggestions(items, onSelect) {
          searchSuggestions.innerHTML = '';
          if (items.length === 0) {
              searchSuggestions.style.display = 'none';
              return;
          }
          items.forEach(item => {
              const div = document.createElement('div');
              div.className = 'search-suggestion-item';
              div.textContent = item.label;
              div.addEventListener('click', () => {
                  searchInput.value = item.label; // Fill input
                  searchSuggestions.style.display = 'none';
                  onSelect(item.data);
              });
              searchSuggestions.appendChild(div);
          });
          searchSuggestions.style.display = 'block';
      }

      // Hide suggestions on outside click
      document.addEventListener('click', (e) => {
          if (searchSuggestions && !searchInput.contains(e.target) && !searchSuggestions.contains(e.target)) {
              searchSuggestions.style.display = 'none';
          }
      });

      // Change placeholder based on type
      if (searchType) {
          searchType.addEventListener('change', () => {
              searchInput.placeholder = searchType.value === 'location' ? 'Search for a location...' : 'Search for a species...';
              if (searchSuggestions) searchSuggestions.style.display = 'none';
              searchInput.value = '';
          });
      }

      // Input Event for Autocomplete
      if (searchInput) {
          searchInput.addEventListener('input', debounce(async (e) => {
              const query = e.target.value.trim();
              if (query.length < 3) {
                  if (searchSuggestions) searchSuggestions.style.display = 'none';
                  return;
              }

              if (searchType.value === 'location') {
                  try {
                      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
                      const data = await res.json();
                      const items = data.map(place => ({
                          label: place.display_name,
                          data: { lat: parseFloat(place.lat), lon: parseFloat(place.lon) }
                      }));
                      showSuggestions(items, (loc) => {
                          map.setView([loc.lat, loc.lon], 12);
                      });
                  } catch (err) { console.error(err); }
              } else {
                  // Species Autocomplete (from local loaded data)
                  // Use Set to get unique names
                  const uniqueSpecies = [...new Set(allSightings.map(s => s.species_name))];
                  const matches = uniqueSpecies.filter(name => name.toLowerCase().includes(query.toLowerCase()));
                  const items = matches.map(name => ({ label: name, data: name }));
                  showSuggestions(items, (name) => {
                       renderMarkers(allSightings.filter(s => s.species_name === name));
                  });
              }
          }, 300));
      }

      // Search Button Click (Manual trigger)
      if (searchBtn) {
          searchBtn.addEventListener('click', async () => {
              const query = searchInput.value.trim();
              if (!query) return;

              if (searchType.value === 'location') {
                  // Fallback to basic search if no suggestion clicked
                  try {
                      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
                      const data = await res.json();
                      if (data && data.length > 0) {
                          const lat = parseFloat(data[0].lat);
                          const lon = parseFloat(data[0].lon);
                          map.setView([lat, lon], 12);
                      } else {
                          alert('Location not found');
                      }
                  } catch (e) {
                      console.error(e);
                      alert('Error searching location');
                  }
              } else {
                  // Filter species
                  renderMarkers(allSightings.filter(s => s.species_name.toLowerCase().includes(query.toLowerCase())));
              }
          });
      }

      // Fetch Sightings (Initial load)
      fetchSightings(map);

      // Re-fetch on map move to get geospatial data
      map.on('moveend', () => {
         fetchSightings(map);
      });

      async function fetchSightings(map) {
          try {
            // Calculate radius and center
            const center = map.getCenter();
            const bounds = map.getBounds();
            const radius = center.distanceTo(bounds.getNorthEast()) / 1000; // Meters to KM

            const res = await fetch(`${API_URL}/api/sightings?lat=${center.lat}&lon=${center.lng}&radius=${radius}`);
            const newSightings = await res.json();

            // Merge or replace?
            // For simplicity and to support search filter, let's replace `allSightings`
            // but keep the current search filter if active?
            // Actually, simpler: just update the "all data" and re-render.
            allSightings = newSightings;

            // If search is active, we should re-apply it?
            const query = searchInput ? searchInput.value.trim() : '';
            if (query && searchType && searchType.value === 'species') {
                 renderMarkers(allSightings.filter(s => s.species_name.toLowerCase().includes(query.toLowerCase())));
            } else {
                 renderMarkers(allSightings);
            }

          } catch(err) {
              console.error("Error loading sightings", err);
          }
      }

      function renderMarkers(sightings) {
          markersLayer.clearLayers();
          sightings.forEach(s => {
            const marker = L.marker([s.latitude, s.longitude]);

            // Create popup content safely
            const container = document.createElement('div');

            const title = document.createElement('b');
            title.textContent = s.species_name;
            container.appendChild(title);
            container.appendChild(document.createElement('br'));

            const dateNode = document.createTextNode(new Date(s.sighting_date).toLocaleDateString());
            container.appendChild(dateNode);
            container.appendChild(document.createElement('br'));

            if (s.photo_url) {
                const img = document.createElement('img');
                img.src = s.photo_url;
                img.className = 'popup-img';
                img.alt = s.species_name;
                container.appendChild(img);
            }

            if (s.sighting_notes) {
                const p = document.createElement('p');
                p.textContent = s.sighting_notes; // Safe text insertion
                container.appendChild(p);
            }

            marker.bindPopup(container);
            markersLayer.addLayer(marker);
        });
      }
  }


  // --- Page: New Sighting ---
  if (document.getElementById('sightingForm')) {
      // Map Picker
      const mapPicker = L.map('mapPicker').setView([0, 0], 2);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapPicker);

      let currentMarker = null;
      mapPicker.on('click', (e) => {
          if (currentMarker) mapPicker.removeLayer(currentMarker);
          currentMarker = L.marker(e.latlng).addTo(mapPicker);
          document.getElementById('latitude').value = e.latlng.lat;
          document.getElementById('longitude').value = e.latlng.lng;
          document.getElementById('coordsDisplay').innerText = `${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`;
      });

      // Try to locate user for convenience
      mapPicker.locate({setView: true, maxZoom: 12});

      // Species Auto-complete
      const speciesInput = document.getElementById('speciesName');
      const suggestionsBox = document.getElementById('suggestions');
      let debounceTimer;

      speciesInput.addEventListener('input', (e) => {
          const query = e.target.value;
          if (query.length < 3) { suggestionsBox.style.display = 'none'; return; }

          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(async () => {
              try {
                  const res = await fetch(`${API_URL}/api/species?name=${query}`); // Using our proxy
                  const animals = await res.json();

                  suggestionsBox.innerHTML = '';
                  if (animals.length > 0) {
                      animals.forEach(animal => {
                          const div = document.createElement('div');
                          div.className = 'suggestion-item';
                          div.innerText = animal.name;
                          div.onclick = () => {
                              speciesInput.value = animal.name;
                              suggestionsBox.style.display = 'none';
                          };
                          suggestionsBox.appendChild(div);
                      });
                      suggestionsBox.style.display = 'block';
                  } else {
                       suggestionsBox.style.display = 'none';
                  }
              } catch(err) {
                  console.error(err);
              }
          }, 300);
      });

      // Submit Form
      document.getElementById('sightingForm').addEventListener('submit', async (e) => {
          e.preventDefault();

          const lat = document.getElementById('latitude').value;
          const lon = document.getElementById('longitude').value;

          if (!lat || !lon) {
              showMessage('Please select a location on the map.', 'danger');
              return;
          }

          const formData = new FormData();
          formData.append('species_name', document.getElementById('speciesName').value);
          formData.append('latitude', lat);
          formData.append('longitude', lon);
          formData.append('sighting_date', document.getElementById('sightingDate').value);
          formData.append('sighting_notes', document.getElementById('sightingNotes').value);

          const fileInput = document.getElementById('sightingPhoto');
          if (fileInput.files[0]) {
              formData.append('photo', fileInput.files[0]);
          }

          try {
              const res = await fetch(`${API_URL}/api/sightings`, {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${token}` }, // FormData sets Content-Type automatically
                  body: formData
              });
              const data = await res.json();
              if (res.status === 201) {
                  showMessage('Sighting submitted successfully!', 'success');
                  setTimeout(() => { window.location.href = 'index.html'; }, 2000);
              } else {
                  showMessage(`Error: ${data.message}`, 'danger');
              }
          } catch(err) {
              showMessage(`Error: ${err.message}`, 'danger');
          }
      });
  }

  // --- Page: Dashboard ---
  if (document.getElementById('userSightingsList')) {
      // Load Profile
      // We don't have a "get profile" endpoint, we can infer from "get user sightings" or add one.
      // Or we can just update blind. Let's add a quick "get profile" fetch if needed,
      // but typically we'd store user info in localStorage or fetch it.
      // Since I didn't make a GET /me endpoint, I'll skip pre-filling the profile form for now
      // OR I can quickly add a "GET /me" endpoint if I want perfection.
      // For now, let's focus on sightings list.

      async function loadUserSightings() {
          try {
              const res = await fetch(`${API_URL}/api/sightings/user`, {
                  headers: { 'Authorization': `Bearer ${token}` }
              });
              const sightings = await res.json();
              const container = document.getElementById('userSightingsList');
              container.innerHTML = '';

              if (sightings.length === 0) {
                  container.innerHTML = '<p>No sightings yet.</p>';
                  return;
              }

              sightings.forEach(s => {
                  const col = document.createElement('div');
                  col.className = 'col-md-6 mb-3';

                  const card = document.createElement('div');
                  card.className = 'card sighting-card';

                  if (s.photo_url) {
                      const img = document.createElement('img');
                      img.src = s.photo_url;
                      img.className = 'card-img-top';
                      img.alt = s.species_name;
                      card.appendChild(img);
                  }

                  const cardBody = document.createElement('div');
                  cardBody.className = 'card-body';

                  const h5 = document.createElement('h5');
                  h5.className = 'card-title';
                  h5.textContent = s.species_name;
                  cardBody.appendChild(h5);

                  const p = document.createElement('p');
                  p.className = 'card-text';

                  const small = document.createElement('small');
                  small.className = 'text-muted';
                  small.textContent = new Date(s.sighting_date).toLocaleString();
                  p.appendChild(small);
                  p.appendChild(document.createElement('br'));

                  if (s.sighting_notes) {
                      const notesSpan = document.createElement('span');
                      notesSpan.textContent = s.sighting_notes;
                      p.appendChild(notesSpan);
                  }

                  cardBody.appendChild(p);

                  // Delete Button
                  const delBtn = document.createElement('button');
                  delBtn.className = 'btn btn-danger btn-sm delete-btn me-2';
                  delBtn.setAttribute('data-id', s.sighting_id);
                  delBtn.textContent = 'Delete';
                  cardBody.appendChild(delBtn);

                  // Edit Button
                  const editBtn = document.createElement('button');
                  editBtn.className = 'btn btn-secondary btn-sm edit-btn';
                  editBtn.setAttribute('data-id', s.sighting_id);
                  editBtn.textContent = 'Edit';
                  cardBody.appendChild(editBtn);

                  card.appendChild(cardBody);
                  col.appendChild(card);
                  container.appendChild(col);
              });

              // Add delete handlers
              document.querySelectorAll('.delete-btn').forEach(btn => {
                  btn.addEventListener('click', async (e) => {
                      if (!confirm('Are you sure?')) return;
                      const id = e.target.getAttribute('data-id');
                      try {
                          const delRes = await fetch(`${API_URL}/api/sightings/${id}`, {
                              method: 'DELETE',
                              headers: { 'Authorization': `Bearer ${token}` }
                          });
                          if (delRes.ok) {
                              loadUserSightings(); // Reload
                          } else {
                              alert('Failed to delete');
                          }
                      } catch(err) { console.error(err); }
                  });
              });

          } catch(err) {
              console.error(err);
          }
      }

      loadUserSightings();

      // Edit Modal Logic
      let editModalInstance = null;
      if (typeof bootstrap !== 'undefined') {
          const editModalEl = document.getElementById('editModal');
          if (editModalEl) {
              editModalInstance = new bootstrap.Modal(editModalEl);
          }
      }

      // Handle Edit Click (Delegated in loadUserSightings, but we need the update logic here)
      document.addEventListener('click', (e) => {
          if (e.target && e.target.classList.contains('edit-btn')) {
              const id = e.target.getAttribute('data-id');
              const cardBody = e.target.closest('.card-body');
              const species = cardBody.querySelector('.card-title').textContent;
              const notes = cardBody.querySelector('span') ? cardBody.querySelector('span').textContent : '';
              // Date is a bit tricky to parse back from locale string, so we might want to store raw date or just let user pick new
              // For now, let's just pre-fill what we can easily.

              document.getElementById('editSightingId').value = id;
              document.getElementById('editSpeciesName').value = species;
              document.getElementById('editSightingNotes').value = notes;

              if (editModalInstance) editModalInstance.show();
          }
      });

      // Handle Edit Submit
      const editSightingForm = document.getElementById('editSightingForm');
      if (editSightingForm) {
          editSightingForm.addEventListener('submit', async (e) => {
              e.preventDefault();
              const id = document.getElementById('editSightingId').value;
              const species = document.getElementById('editSpeciesName').value;
              const notes = document.getElementById('editSightingNotes').value;
              const date = document.getElementById('editSightingDate').value;

              try {
                  const res = await fetch(`${API_URL}/api/sightings/${id}`, {
                      method: 'PUT',
                      headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${token}`
                      },
                      body: JSON.stringify({
                          species_name: species,
                          sighting_notes: notes,
                          sighting_date: date
                      })
                  });

                  if (res.ok) {
                      if (editModalInstance) editModalInstance.hide();
                      loadUserSightings(); // Reload list
                      showMessage('Sighting updated successfully', 'success');
                  } else {
                      alert('Failed to update');
                  }
              } catch(err) { console.error(err); }
          });
      }

      // Handle Profile Update
      const profileForm = document.getElementById('profileForm');
      if (profileForm) {
          profileForm.addEventListener('submit', async (e) => {
              e.preventDefault();
              const username = document.getElementById('profileUsername').value;
              const email = document.getElementById('profileEmail').value;
              const phone = document.getElementById('profilePhone').value;

              const body = {};
              if (username) body.username = username;
              if (email) body.email = email;
              if (phone) body.phone_number = phone;

              try {
                  const res = await fetch(`${API_URL}/api/user/profile`, {
                      method: 'PUT',
                      headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${token}`
                      },
                      body: JSON.stringify(body)
                  });
                  const data = await res.json();
                  if (res.ok) {
                      showMessage('Profile updated successfully!', 'success');
                  } else {
                      showMessage(`Error: ${data.message}`, 'danger');
                  }
              } catch(err) {
                  showMessage(`Error: ${err.message}`, 'danger');
              }
          });
      }
  }

});
