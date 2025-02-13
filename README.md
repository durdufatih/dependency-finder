# Dependency Finder

A Node.js service that analyzes dependencies from different project types (Node.js, Java, Python, Gradle) and provides information about current and latest versions.

## Features

- Supports multiple project types:
  - Node.js (package.json)
  - Java (pom.xml)
  - Python (requirements.txt)
  - Gradle (build.gradle)
- Fetches latest versions from:
  - npm registry
  - Maven Central
  - PyPI
- Handles various dependency formats and version declarations
- GitHub URL support for direct file analysis

## API Usage

### Analyze Dependencies

```bash
POST /analyze
Request body:

```json
{
  "url": "https://github.com/user/repo/blob/main/pom.xml",
  "language": "java"
}
 ```
```

Supported language values:

- nodejs
- java
- python
- gradle
Example Response:

```json
{
  "dependencies": {
    "spring-boot-starter-web": {
      "groupId": "org.springframework.boot",
      "version": "2.5.0",
      "latestVersion": "3.1.3",
      "source": "direct"
    }
  }
}
 ```
```

## Setup
1. Install dependencies:
```bash
npm install
 ```

2. Start the server:
```bash
npm start
 ```

The server will run on port 3000 by default. You can change this by setting the PORT environment variable.

## Environment Variables
- PORT : Server port (default: 3000)
## Dependencies
- express
- axios
- xml2js
- yaml