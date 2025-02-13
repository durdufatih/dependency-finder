const express = require('express');
const axios = require('axios');
const xml2js = require('xml2js');
const YAML = require('yaml');

const app = express();
app.use(express.json());

async function fetchFileContent(url) {
  try {
    let fetchUrl = url;
    if (url.includes('github.com')) {
      fetchUrl = url
        .replace('github.com', 'raw.githubusercontent.com')
        .replace('/blob/', '/');
      
      // Remove any trailing slashes
      fetchUrl = fetchUrl.replace(/\/$/, '');
    }

    const response = await axios.get(fetchUrl);
    return response.data;
  } catch (error) {
    throw new Error(`Failed to fetch file: ${error.message}`);
  }
}

async function getLatestVersion(packageName) {
  try {
    const response = await axios.get(`https://registry.npmjs.org/${packageName}`);
    return response.data['dist-tags'].latest;
  } catch (error) {
    return null;
  }
}

// Add this new function near the getLatestVersion function
async function getMavenLatestVersion(groupId, artifactId) {
  try {
    const response = await axios.get(`https://search.maven.org/solrsearch/select?q=g:"${groupId}"+AND+a:"${artifactId}"&rows=1&wt=json`);
    if (response.data.response.docs.length > 0) {
      return response.data.response.docs[0].latestVersion;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Add this function for parsing Gradle dependencies
function parseGradleDependencies(content) {
  const dependencies = [];
  const lines = content.split('\n');
  const depRegex = /^\s*(implementation|api|compile|testImplementation|androidTestImplementation|runtimeOnly)\s*['"](.*?):(.+?):(.+?)['"].*$/;
  const versionRegex = /^\s*(\w+)\s*=\s*['"](.*?)['"].*$/;
  
  // Extract versions from ext block
  const versions = {};
  let inExtBlock = false;
  
  lines.forEach(line => {
    if (line.includes('ext {')) {
      inExtBlock = true;
      return;
    }
    if (inExtBlock && line.includes('}')) {
      inExtBlock = false;
      return;
    }
    
    if (inExtBlock) {
      const vMatch = line.match(versionRegex);
      if (vMatch) {
        const [, name, version] = vMatch;
        versions[name] = version;
      }
    }

    const match = line.match(depRegex);
    if (match) {
      const [, scope, groupId, artifactId, version] = match;
      // Check if version is a reference to ext block
      const actualVersion = version.startsWith('$') ? 
        versions[version.replace(/[${}]/g, '')] || version : 
        version;
      
      dependencies.push({ 
        scope, 
        groupId, 
        artifactId, 
        version: actualVersion,
        source: version.startsWith('$') ? 'ext' : 'direct'
      });
    }
  });
  
  return dependencies;
}

async function parseDependencies(content, language) {
  try {
    switch (language.toLowerCase()) {
      case 'nodejs':
        const packageJson = typeof content === 'string' ? JSON.parse(content) : content;
        const dependencies = packageJson.dependencies || {};
        const devDependencies = packageJson.devDependencies || {};
        
        // Get latest versions for dependencies
        const enhancedDependencies = {};
        for (const [name, version] of Object.entries(dependencies)) {
          const latestVersion = await getLatestVersion(name);
          enhancedDependencies[name] = {
            current: version,
            latest: latestVersion
          };
        }

        // Get latest versions for devDependencies
        const enhancedDevDependencies = {};
        for (const [name, version] of Object.entries(devDependencies)) {
          const latestVersion = await getLatestVersion(name);
          enhancedDevDependencies[name] = {
            current: version,
            latest: latestVersion
          };
        }

        return {
          dependencies: enhancedDependencies,
          devDependencies: enhancedDevDependencies
        };

      case 'java':
        const parser = new xml2js.Parser();
        const pomXml = await parser.parseStringPromise(content);
        
        // Extract parent version if available
        const parentVersion = pomXml?.project?.parent?.[0]?.version?.[0];
        
        // Extract properties
        const properties = pomXml?.project?.properties?.[0] || {};
        const propertyVersions = {};
        
        // Convert properties to a flat key-value object
        Object.entries(properties).forEach(([key, value]) => {
          if (Array.isArray(value) && value.length > 0) {
            propertyVersions[key] = value[0];
          }
        });

        // Add null checks and provide default empty array
        const javaDependencies = pomXml?.project?.dependencies?.[0]?.dependency || [];
        
        // Process dependencies with latest versions
        const processedDependencies = {};
        for (const dep of javaDependencies) {
          if (dep?.artifactId?.[0]) {
            const groupId = dep.groupId?.[0];
            const artifactId = dep.artifactId[0];
            let version = dep?.version?.[0] || '';
            let source = 'direct';
            
            // Check if version is a property reference
            if (version.startsWith('${') && version.endsWith('}')) {
              const propertyName = version.slice(2, -1);
              version = propertyVersions[propertyName] || '';
              source = 'properties';
            }
            
            // If no version found, use parent version
            if (!version && parentVersion) {
              version = parentVersion;
              source = 'parent';
            }

            // Get latest version from Maven Central
            const latestVersion = await getMavenLatestVersion(groupId, artifactId);
            
            processedDependencies[artifactId] = {
              groupId,
              version: version || 'unknown',
              latestVersion: latestVersion,
              source: source
            };
          }
        }

        return {
          dependencies: processedDependencies,
          parentInfo: pomXml?.project?.parent?.[0] ? {
            groupId: pomXml.project.parent[0].groupId?.[0],
            artifactId: pomXml.project.parent[0].artifactId?.[0],
            version: parentVersion
          } : null
        };

      case 'gradle':
        const gradleDeps = parseGradleDependencies(content);
        const processedGradleDeps = {};
        
        for (const dep of gradleDeps) {
          const latestVersion = await getMavenLatestVersion(dep.groupId, dep.artifactId);
          
          processedGradleDeps[`${dep.groupId}:${dep.artifactId}`] = {
            groupId: dep.groupId,
            artifactId: dep.artifactId,
            scope: dep.scope,
            version: dep.version,
            latestVersion: latestVersion
          };
        }
        
        return {
          dependencies: processedGradleDeps
        };

      case 'python':
        const pythonDeps = {};
        const pythonLines = content.split('\n')
          .filter(line => line && !line.startsWith('#'));
        
        for (const line of pythonLines) {
          const packages = line.split(';');
          
          for (const pkg of packages) {
            if (!pkg.trim()) continue;
            
            const name = pkg.split(/[=<>~!,]/)[0].trim();
            let currentVersion = 'unspecified';
            let constraintType = 'none';  // Add constraint type
            
            if (pkg.includes('==')) {
              currentVersion = pkg.split('==')[1].trim();
              constraintType = 'exact';
            } else if (pkg.includes('>=')) {
              currentVersion = pkg.split('>=')[1].split(',')[0].trim();
              constraintType = 'minimum';
            } else if (pkg.includes('>')) {
              currentVersion = pkg.split('>')[1].split(',')[0].trim();
              constraintType = 'greater';
            } else if (pkg.includes('<=')) {
              currentVersion = pkg.split('<=')[1].split(',')[0].trim();
              constraintType = 'maximum';
            } else if (pkg.includes('<')) {
              currentVersion = pkg.split('<')[1].split(',')[0].trim();
              constraintType = 'less';
            }
            
            // Add this helper function
            function isPythonVersionPackage(name) {
              return name === 'python_version' || name === 'python';
            }
            
            // In the python case, modify the version fetching part:
                        if (name) {
                          const packageName = name.trim();
                          let latestVersion;
                          
                          if (isPythonVersionPackage(packageName)) {
                            latestVersion = '3.12.0'; // Current stable Python version
                          } else {
                            latestVersion = await getPythonLatestVersion(packageName);
                          }
                          
                          pythonDeps[packageName] = {
                            current: currentVersion.replace(/['"]/g, ''),
                            latest: latestVersion || 'unknown',
                            constraintType: constraintType
                          };
                        }
          }
        }
        
        return { dependencies: pythonDeps };

      default:
        throw new Error('Unsupported project language');
    }
  } catch (error) {
    throw new Error(`Failed to parse dependencies: ${error.message}`);
  }
}

// Add this new function near other version fetching functions
async function getPythonLatestVersion(packageName) {
  try {
    const response = await axios.get(`https://pypi.org/pypi/${packageName}/json`);
    return response.data.info.version;
  } catch (error) {
    return null;
  }
}

app.post('/analyze', async (req, res) => {
  try {
    const { url, language } = req.body;

    if (!url || !language) {
      return res.status(400).json({ error: 'URL and language are required' });
    }

    const content = await fetchFileContent(url);
    const dependencies = await parseDependencies(content, language);

    res.json(dependencies);
  } catch (error) {
    console.log("Error",error)
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});