---
argument-hint: [relative_path]
description: Assess and simplify files or directories
---
**Always obey `.docs/guides/mcp-tools.md`. Read it now if not already in context.**
**Run `/primer` first if you have not already this session.**


**Purpose**: Analyze files or directories to remove redundant information and simplify overly complex structures.

---

## Workflow

### 1. Path Validation
- Accept a relative path parameter (file or directory)
- Validate that the path exists
- Determine if path is a file or directory

### 2. If Directory: List Contents
- Use MCP Serena `list_dir` to list all files (non-recursive initially)
- Display file list with file types and sizes
- Ask user to confirm which files to analyze:
  - All files in directory
  - Specific file types (e.g., only .md files)
  - Specific files from the list
  - Recursive (include subdirectories)

### 3. File Analysis Phase

For each file in scope:

#### 3.1 Read & Categorize
- Use MCP Serena to read file contents
- Identify file type (code, docs, config, etc.)
- Assess file size and complexity

#### 3.2 Identify Redundancies
- **Duplicate Content**: Look for repeated sections, paragraphs, or code blocks
- **Outdated Information**: Check for conflicting or superseded information
- **Over-Documentation**: Identify overly verbose explanations
- **Dead Code**: Find unused imports, functions, or variables (for code files)
- **Redundant Comments**: Locate comments that just restate the code

#### 3.3 Identify Complexity
- **Overly Nested Structures**: Deep nesting in docs or code
- **Long Functions/Sections**: Files or sections that should be split
- **Unclear Organization**: Poor structure or flow
- **Excessive Abstraction**: Over-engineered solutions (violates YAGNI)
- **Inconsistent Formatting**: Mixed styles or conventions

### 4. Proposal Phase

For each file with issues:
- **Summarize findings**:
  - Number of redundancies found
  - Complexity issues identified
  - Estimated reduction in file size/complexity
- **Propose specific changes**:
  - List each redundancy with line numbers
  - Suggest structural improvements
  - Highlight what will be removed/simplified
- **Ask for confirmation** before proceeding

### 5. Execution Phase

With user approval:
- Use MCP Serena symbolic or file-based editing tools
- Apply changes file by file
- Show diff/summary of changes made
- Mark each file as complete

### 6. Verification Phase

After changes:
- For code files:
  - Run appropriate quality gates (mypy, type-check) from `.docs/agent/quality-gates.md`
  - Ensure no functionality broken
- For documentation:
  - Verify all critical information retained
  - Check links and references still valid
- Provide summary report:
  - Files modified
  - Total lines removed
  - Complexity improvements

---

## Special Handling by File Type

### Code Files (.py, .ts, .tsx)
- Use MCP Serena symbolic tools for analysis
- Check for:
  - Unused imports
  - Dead code
  - Duplicate functions
  - Over-complex logic that violates KISS
  - Premature abstractions that violate YAGNI
- Ensure quality gates pass after changes

### Documentation Files (.md)
- Check for:
  - Duplicate sections
  - Outdated information
  - Overly verbose explanations
  - Broken or redundant links
  - Inconsistent formatting
- Preserve critical information and structure

### Configuration Files (.json, .yaml, .toml)
- Check for:
  - Duplicate keys
  - Unused configurations
  - Overly complex structures
  - Comments that could be simplified
- Be conservative - only remove clearly unused items


---

## Multi-File Simplification

When analyzing multiple files in a directory, actively look for opportunities to **combine, merge, and delete** files while preserving all critical information.

### Combining Related Files

**When to combine**:
- Multiple small files covering the same topic
- Files that are always used together
- Split files with no clear separation of concerns
- Files with significant overlap in content

**Process**:
1. Identify files that could be combined
2. Analyze content overlap and relationships
3. Propose merge strategy (primary destination, organization, duplicates to remove)
4. Create combined file with improved structure
5. Delete source files after verification

### Merging Overlapping Content

**When to merge**:
- Different files documenting the same feature
- Duplicate getting-started guides
- Multiple READMEs at different levels with redundant info
- Configuration examples scattered across files

**Process**:
1. Map content across files to identify overlaps
2. Determine canonical location for each piece of information
3. Propose merge plan (primary file, cross-references, sections to consolidate)
4. Execute merge with user approval
5. Update all references and links

### Deleting Redundant Files

**Safe to delete when**:
- File is completely duplicated elsewhere
- File is outdated and superseded by newer documentation
- File contains only information available in other files
- File is a leftover from refactoring/renaming

**NEVER delete without verification**:
- Check for unique examples or edge cases
- Search for internal links pointing to the file
- Verify no unique configuration or data
- Confirm with user before deletion

**Deletion process**:
1. Identify potentially redundant files
2. For each file, verify all information exists elsewhere
3. Search for incoming links (grep for filename in codebase)
4. Propose deletion with evidence
5. Delete only with user approval

### Multi-File Analysis Strategy

1. **Initial Scan**: List files, categorize by type/topic, identify obvious duplicates
2. **Content Mapping**: Extract key topics, build topic → files matrix
3. **Overlap Analysis**: Compare files on same topic, calculate overlap percentage
4. **Consolidation Proposal**: Group related files, propose operations, calculate reduction
5. **User Confirmation**: Show detailed proposal with rationale and impact
6. **Execution**: Create merged files → verify → update references → delete redundant files
7. **Verification**: Check links, verify no information lost, ensure navigation clear

### Critical Information Protection

**Always preserve**:
- Unique code examples and snippets
- Specific configuration values
- Historical context or migration notes
- Warnings and caveats
- API contracts and interfaces
- Version-specific information
- Troubleshooting steps
- Known issues and workarounds

**Before deleting any file**:
- Run full-text search for unique phrases
- Check for unique code blocks
- Verify all examples exist elsewhere
- Search for incoming references
- Create summary of unique content (if any)
- **If in doubt**: Keep the file or ask the user

---

## Safety Checks

- **Never delete critical information** without explicit user confirmation
- **Always preserve** unique examples, warnings, API contracts, active configurations
- **Ask before** removing entire sections, consolidating files, changing public APIs
- **Verify after** code compiles, documentation makes sense, links work

---

## Notes

- Use MCP Serena for all file operations and code analysis
- Follow KISS, DRY, YAGNI principles when simplifying
- Be conservative - better to keep something potentially useful than delete it
- Focus on removing true redundancy, not just reducing size
- Maintain readability and clarity as primary goals
- For multi-file operations, always show consolidation plan before execution
