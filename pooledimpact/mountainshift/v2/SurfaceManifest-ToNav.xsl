<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <!-- Flattens a surfaceManifest (which may nest a group node around its
       children) into the flat {group, items:[{id,label}]} shape
       Org-Reports-UI.html's NAV array / renderNav() already consumes.
       Only nodes present in the manifest are ever emitted \u2014 a node
       missing here cannot appear in the rendered menu, regardless of
       what exists in the application's own JS. -->
  <xsl:output method="text"/>
  <xsl:template match="/surfaceManifest">
    <xsl:text>[</xsl:text>
    <xsl:for-each select="node">
      <xsl:if test="position() &gt; 1">,</xsl:if>
      <xsl:text>{"group":"</xsl:text><xsl:value-of select="@group"/><xsl:text>","items":[</xsl:text>
      <xsl:for-each select="node">
        <xsl:if test="position() &gt; 1">,</xsl:if>
        <xsl:text>{"id":"</xsl:text><xsl:value-of select="@id"/>
        <xsl:text>","label":"</xsl:text><xsl:value-of select="@label"/><xsl:text>"}</xsl:text>
      </xsl:for-each>
      <xsl:text>]}</xsl:text>
    </xsl:for-each>
    <xsl:text>]</xsl:text>
  </xsl:template>
</xsl:stylesheet>
