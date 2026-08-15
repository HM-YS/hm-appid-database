const core = require('@actions/core');
const fs = require('fs');

const key = process.env.STEAM_KEY;

const baseURL =
    'https://api.steampowered.com/IStoreService/GetAppList/v1/?';

const categories = [
    'games',
    'dlc',
    'software',
    'videos',
    'hardware'
];

const MAX_RESULTS = 50000;
const REQUEST_TIMEOUT = 30000;
const MAX_ATTEMPTS = 4;
const RETRY_DELAY = 2000;

if (!key) {
    core.setFailed('STEAM_KEY is not configured.');
    process.exit(1);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error) {

    if (!error) {
        return false;
    }

    if (error.status) {

        if (error.status === 429) {
            return true;
        }

        if (error.status >= 500 && error.status <= 599) {
            return true;
        }
    }

    const message =
        error.message
            ? error.message.toLowerCase()
            : '';

    const retryableMessages = [
        'fetch failed',
        'network',
        'timeout',
        'timed out',
        'socket',
        'econnreset',
        'etimedout',
        'eai_again',
        'aborted'
    ];

    return retryableMessages.some(
        text => message.includes(text)
    );
}

async function getAppList(last_appid, endpoint) {

    let url = endpoint;

    if (last_appid) {
        url =
            `${url}&last_appid=${encodeURIComponent(last_appid)}`;
    }

    const safeURL =
        url.replace(
            encodeURIComponent(key),
            '***'
        );

    console.log(`Requesting: ${safeURL}`);

    let lastError = null;

    for (
        let attempt = 1;
        attempt <= MAX_ATTEMPTS;
        attempt++
    ) {

        try {

            const response = await fetch(url, {
                signal: AbortSignal.timeout(
                    REQUEST_TIMEOUT
                )
            });

            if (!response.ok) {

                const error =
                    new Error(
                        `Steam API HTTP ${response.status}: ${response.statusText}`
                    );

                error.status = response.status;

                throw error;
            }

            const jsonData =
                await response.json();

            if (
                !jsonData ||
                !jsonData.response
            ) {

                throw new Error(
                    `Steam API returned an invalid response: ` +
                    `${JSON.stringify(jsonData)}`
                );
            }

            return jsonData;

        } catch (error) {

            lastError = error;

            const retryable =
                isRetryableError(error);

            if (
                !retryable ||
                attempt >= MAX_ATTEMPTS
            ) {
                break;
            }

            const delay =
                RETRY_DELAY *
                Math.pow(2, attempt - 1);

            console.warn(
                `Request failed ` +
                `(attempt ${attempt}/${MAX_ATTEMPTS}).`
            );

            console.warn(
                `Reason: ${
                    error && error.message
                        ? error.message
                        : String(error)
                }`
            );

            console.warn(
                `Retrying in ${delay / 1000}s...`
            );

            await sleep(delay);
        }
    }

    throw lastError;
}

async function requestData(category) {

    const startTime =
        Date.now();

    console.log('');
    console.log(
        `[${category}] Starting...`
    );

    const gameParam =
        `&include_games=${category === 'games'}`;

    const dlcParam =
        `&include_dlc=${category === 'dlc'}`;

    const softwareParam =
        `&include_software=${category === 'software'}`;

    const videosParam =
        `&include_videos=${category === 'videos'}`;

    const hardwareParam =
        `&include_hardware=${category === 'hardware'}`;

    const endpoint =
        `${baseURL}` +
        `key=${encodeURIComponent(key)}` +
        `${gameParam}` +
        `${dlcParam}` +
        `${softwareParam}` +
        `${videosParam}` +
        `${hardwareParam}` +
        `&max_results=${MAX_RESULTS}`;

    let outputJSON = [];

    let have_more_results = true;
    let last_appid = null;

    let page = 0;

    try {

        while (have_more_results) {

            page++;

            console.log(
                `[${category}] Requesting page ${page}...`
            );

            const appList =
                await getAppList(
                    last_appid,
                    endpoint
                );

            const response =
                appList.response;

            const apps =
                Array.isArray(response.apps)
                    ? response.apps
                    : [];

            outputJSON =
                outputJSON.concat(apps);

            have_more_results =
                response.have_more_results === true;

            last_appid =
                response.last_appid || null;

            console.log(
                `[${category}] ` +
                `received ${apps.length} apps, ` +
                `total: ${outputJSON.length}`
            );

            if (
                have_more_results &&
                !last_appid
            ) {

                throw new Error(
                    `[${category}] API says more results exist, ` +
                    `but last_appid was not returned.`
                );
            }
        }

        fs.mkdirSync('./data', {
            recursive: true
        });

        const outputPath =
            `./data/${category}_appid.json`;

        fs.writeFileSync(
            outputPath,
            JSON.stringify(outputJSON)
        );

        const duration =
            (
                (Date.now() - startTime) /
                1000
            ).toFixed(2);

        console.log(
            `[${category}] completed successfully.`
        );

        console.log(
            `[${category}] Total apps: ${outputJSON.length}`
        );

        console.log(
            `[${category}] Total pages: ${page}`
        );

        console.log(
            `[${category}] Duration: ${duration}s`
        );

        console.log(
            `[${category}] Saved to ${outputPath}`
        );

    } catch (error) {

        console.error(
            `[${category}] failed:`,
            error && error.message
                ? error.message
                : error
        );

        throw error;
    }
}

async function run() {

    const startTime =
        Date.now();

    try {

        console.log(
            'Starting Steam App List generation...'
        );

        console.log(
            `Categories: ${categories.join(', ')}`
        );

        console.log(
            `Max results per request: ${MAX_RESULTS}`
        );

        console.log(
            `Request timeout: ${REQUEST_TIMEOUT / 1000}s`
        );

        console.log(
            `Max attempts per request: ${MAX_ATTEMPTS}`
        );

        console.log('');

        await Promise.all(
            categories.map(
                category => requestData(category)
            )
        );

        const duration =
            (
                (Date.now() - startTime) /
                1000
            ).toFixed(2);

        console.log('');
        console.log(
            'All categories completed successfully.'
        );

        console.log(
            `Total duration: ${duration}s`
        );

    } catch (error) {

        console.error(
            'Fatal error:',
            error && error.message
                ? error.message
                : error
        );

        core.setFailed(
            error && error.message
                ? error.message
                : String(error)
        );
    }
}

run();
