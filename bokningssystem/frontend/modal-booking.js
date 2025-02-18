// modal-booking.js

// 1. Lightweight Modal Manager
class ModalManager {
    constructor() {
        this.modalHtml = `
            <div id="BookingModal" class="modal">
                <div class="modal-content">
                    <span class="close">&times;</span>
                    <div id="bookingContainer"></div>
                </div>
            </div>`;

        this.styles = `
            .modal {
                display: none;
                position: fixed;
                z-index: 1000;
                left: 0;
                top: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0,0,0,0.5);
            }
            
            .modal-content {
                background-color: #fefefe;
                margin: 5% auto;
                padding: 20px;
                border-radius: 8px;
                width: 90%;
                max-width: 800px;
                max-height: 90vh;
                overflow-y: auto;
                position: relative;
            }
            
            .close {
                color: #aaa;
                float: right;
                font-size: 28px;
                font-weight: bold;
                cursor: pointer;
            }`;
    }

    init() {
        // Add styles
        const styleSheet = document.createElement("style");
        styleSheet.textContent = this.styles;
        document.head.appendChild(styleSheet);

        // Add modal HTML
        const modalContainer = document.createElement('div');
        modalContainer.innerHTML = this.modalHtml;
        document.body.appendChild(modalContainer.firstChild);

        // Get modal elements
        this.modal = document.getElementById('BookingModal');
        this.closeBtn = this.modal.querySelector('.close');
        this.bookingContainer = document.getElementById('bookingContainer');

        // Add event listeners
        this.closeBtn.onclick = () => this.close();
        window.onclick = (event) => {
            if (event.target === this.modal) {
                this.close();
            }
        };
    }

    async open() {
        // Show loading state
        this.modal.style.display = 'block';
        this.bookingContainer.innerHTML = '<div style="text-align: center; padding: 20px;">Loading booking system...</div>';

        try {
            // Dynamically load booking system
            const response = await fetch('/bokningssystem/frontend/skapabokningchatgptnew.html');
            const html = await response.text();

            // Extract and load required scripts
            const scripts = this.extractScripts(html);
            const mainContent = this.removeScripts(html);

            // Insert main content
            this.bookingContainer.innerHTML = mainContent;

            // Load scripts sequentially
            for (const script of scripts) {
                await this.loadScript(script);
            }

            // Initialize booking system
            if (window.initBookingSystem) {
                window.initBookingSystem();
            }

        } catch (error) {
            console.error('Error loading booking system:', error);
            this.bookingContainer.innerHTML = '<div style="color: red; padding: 20px;">Error loading booking system. Please try again.</div>';
        }
    }

    close() {
        this.modal.style.display = 'none';
        this.bookingContainer.innerHTML = '';
        // Optionally refresh data
        if (window.refreshBookingData) {
            window.refreshBookingData();
        }
    }

    extractScripts(html) {
        const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gm;
        const scripts = [];
        let match;

        while (match = scriptRegex.exec(html)) {
            scripts.push(match[0]);
        }

        return scripts;
    }

    removeScripts(html) {
        return html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gm, '');
    }

    async loadScript(scriptHtml) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            
            // Extract src if external script
            const srcMatch = scriptHtml.match(/src=["'](.*?)["']/);
            if (srcMatch) {
                script.src = srcMatch[1];
                script.onload = resolve;
                script.onerror = reject;
            } else {
                // Inline script
                script.textContent = scriptHtml.replace(/<\/?script[^>]*>/g, '');
                resolve();
            }

            document.body.appendChild(script);
        });
    }
}

// 2. Usage Example
const bookingSystem = new ModalManager();

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    bookingSystem.init();
});

// Open booking modal
function openBooking() {
    bookingSystem.open();
}