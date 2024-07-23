const fs = require('fs');
const path = require('path');
const readline = require('readline');
const simpleGit = require('simple-git');
const git = simpleGit();

const newVersion = process.argv[2]; // Get new version from command line arguments

if (!newVersion) {
    console.error('Please provide the new version as an argument');
    process.exit(1);
}

const filesToUpdate = [
    'manifest.json',
    'package-lock.json',
    'package.json',
    'versions.json'
];

filesToUpdate.forEach(file => {
    const filePath = path.join(__dirname, file);
    const fileContent = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (file === 'versions.json') {
        const lastVersion = Object.keys(fileContent).pop();
        fileContent[lastVersion] = "0.15.0";
        fileContent[newVersion] = "0.15.0";
    } else {
        fileContent.version = newVersion;
    }

    fs.writeFileSync(filePath, JSON.stringify(fileContent, null, 2), 'utf8');
});

// Function to ask for user confirmation
const askQuestion = (query) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }))
}

// Show the changes that are about to be committed
const showChanges = async () => {
    console.log('The following changes will be committed:');
    await git.status().then(status => {
        console.log(status.modified);
    });
}

const commitAndTag = async () => {
    await showChanges();

    const commitConfirmation = await askQuestion('Do you want to commit these changes? (yes/no) ');
    if (commitConfirmation.toLowerCase() !== 'yes') {
        console.log('Aborting commit.');
        process.exit(1);
    }

    const commitMessage = `New version release ${newVersion}`;

    try {
        await git.add(filesToUpdate);
        await git.commit(commitMessage);
        await git.push('origin', 'master');
    } catch (err) {
        console.error('Failed to execute git commit commands', err);
        process.exit(1);
    }

    const tagConfirmation = await askQuestion('Do you want to tag this commit? (yes/no) ');
    if (tagConfirmation.toLowerCase() !== 'yes') {
        console.log('Aborting tag.');
        process.exit(1);
    }

    try {
        await git.tag(['-a', newVersion, '-m', newVersion]);
        await git.pushTags('origin');
        console.log(`Successfully tagged and pushed version ${newVersion}`);
    } catch (err) {
        console.error('Failed to execute git tag commands', err);
        process.exit(1);
    }
}

commitAndTag();
