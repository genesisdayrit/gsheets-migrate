process.__originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  if (args[0] === "DeprecationWarning") {
    return; // Suppress only DeprecationWarnings
  }
  return process.__originalEmitWarning(warning, ...args);
};

const fs = require("fs");
const { google } = require("googleapis");
const yaml = require("js-yaml");
require("dotenv").config();

// Load Google Sheets API client
async function authorize() {
  const credentialsPath = process.env.GDRIVE_CREDENTIALS_PATH;
  if (!credentialsPath) {
    throw new Error("Environment variable GDRIVE_CREDENTIALS_PATH is not set.");
  }

  const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  const { client_email, private_key } = credentials;
  const auth = new google.auth.JWT(client_email, null, private_key, [
    "https://www.googleapis.com/auth/spreadsheets",
  ]);
  await auth.authorize();
  return auth;
}

// Load schema from YAML
function loadSchema(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Schema file not found at path: ${filePath}`);
  }

  const fileContents = fs.readFileSync(filePath, "utf8");
  return yaml.load(fileContents);
}

// Compare schema with the existing sheet and update columns if needed
async function updateTabs(sheetId, schema) {
  const auth = await authorize();
  const sheets = google.sheets({ version: "v4", auth });

  for (const tab of schema.tabs) {
    try {
      // Check if the tab exists
      const sheet = await sheets.spreadsheets.get({
        spreadsheetId: sheetId,
        ranges: [`${tab.name}!A1:Z1`],
        includeGridData: true,
      });

      const sheetData = sheet.data.sheets.find((s) => s.properties.title === tab.name);
      if (!sheetData) {
        console.log(`Tab "${tab.name}" does not exist.`);
        continue;
      }

      // Extract existing columns from the first row
      const existingColumns =
        sheetData.data[0]?.rowData[0]?.values?.map((cell) =>
          cell.formattedValue ? cell.formattedValue : ""
        ) || [];

      // Compare existing columns with schema
      const schemaColumns = tab.columns;
      if (JSON.stringify(existingColumns) === JSON.stringify(schemaColumns)) {
        console.log(`Tab "${tab.name}" is already up-to-date.`);
        continue;
      }

      // Update columns if there's a difference
      console.log(`Updating columns for tab "${tab.name}"...`);
      const range = `${tab.name}!A1:${String.fromCharCode(64 + schemaColumns.length)}1`;
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range,
        valueInputOption: "RAW",
        requestBody: {
          values: [schemaColumns],
        },
      });

      console.log(`Columns updated for tab "${tab.name}": ${schemaColumns.join(", ")}`);
    } catch (error) {
      if (error.code === 400) {
        console.log(`Tab "${tab.name}" does not exist.`);
      } else {
        console.error(`Error processing tab "${tab.name}":`, error.message);
      }
    }
  }
}

// Main function
(async function main() {
  const schemaPath = process.env.SCHEMA_FILE_PATH;
  const sheetId = process.env.GSHEET_ID;

  if (!schemaPath) {
    throw new Error("Environment variable SCHEMA_FILE_PATH is not set.");
  }

  if (!sheetId) {
    throw new Error("Environment variable GSHEET_ID is not set.");
  }

  try {
    const schema = loadSchema(schemaPath);
    await updateTabs(sheetId, schema);
    console.log("Schema validation and updates completed!");
  } catch (error) {
    console.error("Error updating schema:", error.message);
  }
})();

