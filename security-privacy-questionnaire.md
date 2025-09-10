01.  What information might this feature expose to Web sites or other parties,
     and for what purposes is that exposure necessary?
     
     No new information will be exposed to the site. This feature only enables drawing information that will not expose security or privacy information.
     
02.  Do features in your specification expose the minimum amount of information
     necessary to enable their intended uses?
     
     Yes.
     
03.  How do the features in your specification deal with personal information,
     personally-identifiable information (PII), or information derived from
     them?
     
     Since the feature renders pixels from DOM elements into canvas, those pixels can now be accessed by script. This requires ensuring that no PII is present in those pixels, for example different styles for visited links, spell check etc. Disabling painting of this information also prevents revealing invalidation information via the repaint callback (the `fireOnEveryPaint` option added to ResizeObserver). See [privacy-preserving-painting](https://github.com/WICG/html-in-canvas/tree/main?tab=readme-ov-file#privacy-preserving-painting) for additional details.
     
04.  How do the features in your specification deal with sensitive information?
     
     See answer above, the feature ensures no sensitive user information on the DOM content is available when painting it into a texture which will be accessible to script.

05.  Do the features in your specification introduce new state for an origin
     that persists across browsing sessions?
     
     No.
     
06.  Do the features in your specification expose information about the
     underlying platform to origins?
     
     Similar to #3, the painting of information revealing information about the underlying platform (e.g., form autofill) is disabled. See [privacy-preserving-painting](https://github.com/WICG/html-in-canvas/tree/main?tab=readme-ov-file#privacy-preserving-painting) for additional details.
     
8.  Does this specification allow an origin to send data to the underlying
     platform?
     
     No.
     
9.  Do features in this specification enable access to device sensors?

     No.
     
10.  Do features in this specification enable new script execution/loading
     mechanisms?
     
     No.
     
11.  Do features in this specification allow an origin to access other devices?

     No.
     
12.  Do features in this specification allow an origin some measure of control over
     a user agent's native UI?
     
     No.
     
13.  What temporary identifiers do the features in this specification create or
     expose to the web?
     
     None.
     
14.  How does this specification distinguish between behavior in first-party and
     third-party contexts?
     
     There is no difference in behaviour.
     
15.  How do the features in this specification work in the context of a browser’s
     Private Browsing or Incognito mode?
     
     There is no difference in behaviour for these modes.
     
16.  Does this specification have both "Security Considerations" and "Privacy
     Considerations" sections?
     
     The specification is still in progress. The privacy issues have been highlighted in the explainer.
     
17.  Do features in your specification enable origins to downgrade default
     security protections?
     
     No.
     
18.  How does your feature handle non-"fully active" documents?

     It only works in fully active documents.
     
19.  What should this questionnaire have asked?

     No suggestions.
