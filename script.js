document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const reelUrlInput = document.getElementById('reelUrl');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const clipboardBtn = document.getElementById('clipboardBtn');
    const loader = document.getElementById('loader');
    const downloadOptions = document.getElementById('downloadOptions');
    const errorMessage = document.getElementById('errorMessage');
    const errorText = document.getElementById('errorText');
    const downloadAudio = document.getElementById('downloadAudio');
    const fallbackDownload = document.getElementById('fallbackDownload');
    const manualDownloadLink = document.getElementById('manualDownloadLink');
    
    // Modal elements
    const aboutLink = document.getElementById('aboutLink');
    const privacyLink = document.getElementById('privacyLink');
    const aboutModal = document.getElementById('aboutModal');
    const privacyModal = document.getElementById('privacyModal');
    const closeAboutModal = document.getElementById('closeAboutModal');
    const closePrivacyModal = document.getElementById('closePrivacyModal');

    // Current download info
    let currentAudioUrl = '';
    let currentAudioFilename = '';
    let currentMediaData = null;
    
    // API base URL - configured for local development with frontend on port 5500 and backend on port 7777
    const API_BASE_URL = 'http://localhost:7777/api';

    // Clipboard functionality
    clipboardBtn.addEventListener('click', async () => {
        try {
            // Request permission to read from clipboard
            const text = await navigator.clipboard.readText();
            reelUrlInput.value = text;
            
            // Show a success notification
            showNotification('URL pasted from clipboard', 'success');
            
            // Focus on the input
            reelUrlInput.focus();
        } catch (err) {
            console.error('Failed to read clipboard contents: ', err);
            showNotification('Could not access clipboard. Please check permissions.', 'error');
        }
    });

    // Function to validate URL
    function isValidUrl(url) {
        if (!url) return false;
        
        // Check if it's a reasonable URL format
        try {
            new URL(url);
            
            // Check if it's likely a YouTube URL
            return url.includes('youtube.com') || url.includes('youtu.be');
        } catch (e) {
            return false;
        }
    }

    // Function to get proper URL object with params for audio download
    function getAudioDownloadUrl(videoInfo) {
        // Create a URL object for audio downloads
        const apiUrl = new URL(`${API_BASE_URL}/download/audio`);
        
        // Add parameters
        apiUrl.searchParams.append('url', videoInfo.url);
        apiUrl.searchParams.append('platform', videoInfo.platform);
        apiUrl.searchParams.append('title', videoInfo.title || 'audio');
        
        // Log the URL for debugging
        console.log(`Generated audio download URL:`, apiUrl.toString());
        
        return apiUrl.toString();
    }

    // Process URL using the server API
    function analyzeUrl(url) {
        return new Promise((resolve, reject) => {
            if (!isValidUrl(url)) {
                reject(new Error('Invalid YouTube URL. Please enter a valid YouTube link.'));
                return;
            }

            // Call server API to process URL
            console.log(`Calling API to process URL: ${url}`);
            fetch(`${API_BASE_URL}/process`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url }),
            })
            .then(response => {
                if (!response.ok) {
                    console.error(`Server returned ${response.status}: ${response.statusText}`);
                    throw new Error(`Server error: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (!data.success) {
                    console.error('API returned error:', data.error);
                    throw new Error(data.error || 'Failed to process URL');
                }
                
                console.log('API returned data:', data);
                
                // Store video information
                currentMediaData = data.videoInfo;
                currentMediaData.platform = data.platform;
                
                // Generate download URL for audio
                currentAudioUrl = getAudioDownloadUrl(currentMediaData);
                
                // Set filename
                currentAudioFilename = `${currentMediaData.title || 'audio'}.mp3`;
                
                resolve(currentMediaData);
            })
            .catch(error => {
                console.error('Error analyzing URL:', error);
                reject(new Error(error.message || 'Failed to analyze URL. Please try again.'));
            });
        });
    }

    // Start download for audio
    function initiateAudioDownload(url, filename) {
        showNotification(`Starting audio download. This may take a few moments...`, 'info');
        
        // Show fallback option right away
        fallbackDownload.style.display = 'block';
        manualDownloadLink.setAttribute('href', url);
        manualDownloadLink.setAttribute('download', filename);
        
        // Use fetch to trigger the download rather than navigation
        fetch(url)
            .then(response => {
                if (!response.ok) {
                    return response.json().then(data => {
                        throw new Error(data.message || `Server returned ${response.status}: ${response.statusText}`);
                    }).catch(e => {
                        // If the response is not JSON, or has no message
                        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
                    });
                }
                return response.blob();
            })
            .then(blob => {
                // Create a blob URL for the download
                const blobUrl = URL.createObjectURL(blob);
                
                // Create a link and trigger the download
                const downloadLink = document.createElement('a');
                downloadLink.href = blobUrl;
                downloadLink.download = filename;
                downloadLink.style.display = 'none';
                document.body.appendChild(downloadLink);
                
                // Trigger the download
                downloadLink.click();
                
                // Clean up
                setTimeout(() => {
                    document.body.removeChild(downloadLink);
                    URL.revokeObjectURL(blobUrl);
                }, 1000);
                
                showNotification(`Audio download complete!`, 'success');
            })
            .catch(error => {
                console.error('Download error:', error);
                
                // Check for specific errors
                if (error.message.includes('501')) {
                    showNotification(`This feature is coming soon! We're still working on audio downloads for this platform.`, 'warning');
                } else if (error.message.includes('503') || error.message.includes('temporarily unavailable')) {
                    showNotification(`YouTube Shorts downloads are temporarily unavailable due to YouTube API changes. Please try a regular YouTube video instead.`, 'warning');
                } else {
                    showNotification(`Download error: ${error.message}. Please try again later.`, 'error');
                }
            });
    }

    // Clear UI states
    function resetUI() {
        loader.style.display = 'none';
        downloadOptions.style.display = 'none';
        errorMessage.classList.remove('show');
        fallbackDownload.style.display = 'none';
    }

    // Event Listeners
    analyzeBtn.addEventListener('click', () => {
        const url = reelUrlInput.value.trim();
        
        if (!url) {
            errorText.textContent = 'Please enter a YouTube URL';
            errorMessage.classList.add('show');
            return;
        }
        
        // Reset UI
        resetUI();
        
        // Show loader
        loader.style.display = 'flex';
        
        // Process URL
        analyzeUrl(url)
            .then(data => {
                // Hide loader
                loader.style.display = 'none';
                
                // Show download options
                downloadOptions.style.display = 'block';
                
                // Show platform-specific message
                if (data.platform === 'youtube') {
                    showNotification('YouTube video detected - ready for audio extraction', 'success');
                } else {
                    showNotification(`${data.platform} content detected - We're working on implementing ${data.platform} downloads`, 'warning');
                }
                
                // Set up download button
                downloadAudio.onclick = () => {
                    initiateAudioDownload(currentAudioUrl, currentAudioFilename);
                };
            })
            .catch(error => {
                // Hide loader
                loader.style.display = 'none';
                
                // Show error
                errorText.textContent = error.message;
                errorMessage.classList.add('show');
            });
    });

    // Enter key in input triggers analyze
    reelUrlInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            analyzeBtn.click();
        }
    });

    // Manual download link
    manualDownloadLink.addEventListener('click', (e) => {
        // Instead of allowing the default behavior, we'll handle it ourselves
        e.preventDefault();
        
        // Get the URL and filename
        const url = manualDownloadLink.getAttribute('href');
        const filename = manualDownloadLink.getAttribute('download');
        
        // Use the same fetch approach as the main download function
        fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Server returned ${response.status}: ${response.statusText}`);
                }
                return response.blob();
            })
            .then(blob => {
                // Create a blob URL for the download
                const blobUrl = URL.createObjectURL(blob);
                
                // Create a link and trigger the download
                const downloadLink = document.createElement('a');
                downloadLink.href = blobUrl;
                downloadLink.download = filename;
                downloadLink.style.display = 'none';
                document.body.appendChild(downloadLink);
                
                // Trigger the download
                downloadLink.click();
                
                // Clean up
                setTimeout(() => {
                    document.body.removeChild(downloadLink);
                    URL.revokeObjectURL(blobUrl);
                }, 1000);
                
                showNotification('Manual download complete!', 'success');
            })
            .catch(error => {
                console.error('Manual download error:', error);
                showNotification(`Download error: ${error.message}`, 'error');
            });
    });

    // Modal handling
    aboutLink.addEventListener('click', (e) => {
        e.preventDefault();
        aboutModal.style.display = 'flex';
    });
    
    privacyLink.addEventListener('click', (e) => {
        e.preventDefault();
        privacyModal.style.display = 'flex';
    });
    
    closeAboutModal.addEventListener('click', () => {
        aboutModal.style.display = 'none';
    });
    
    closePrivacyModal.addEventListener('click', () => {
        privacyModal.style.display = 'none';
    });
    
    // Close modals when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === aboutModal) {
            aboutModal.style.display = 'none';
        }
        if (e.target === privacyModal) {
            privacyModal.style.display = 'none';
        }
    });

    // Add a notification system for progress updates
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `<p>${message}</p><span class="close-notification">&times;</span>`;
        document.body.appendChild(notification);
        
        // Add close functionality
        notification.querySelector('.close-notification').addEventListener('click', () => {
            notification.remove();
        });
        
        // Auto close after 5 seconds
        setTimeout(() => {
            if (document.body.contains(notification)) {
                notification.remove();
            }
        }, 5000);
    }

    // Fix CSS display issue with error message
    errorMessage.classList.remove('show');
}); 